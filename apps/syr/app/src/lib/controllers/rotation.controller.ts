import {
	initCryptoWasm,
	createRotationStatement,
	verifyRotationChain,
	generateRootKeypair,
	derivePublicKeyFromSeed,
	decodePublicKey,
	constantTimeEqual,
	encodeMultibase,
	sign
} from '@syr-is/crypto';
import { createAegisBundle } from '@syr-is/crypto/aegis';
import type { AegisBundle } from '@syr-is/crypto/aegis';
import { stringToRecordId } from '@syr-is/types';
import type { Identity, RotationStatement } from '@syr-is/types';
import type { RecordId } from 'surrealdb';
import { identityRepository, delegatedKeyRepository } from '$lib/repositories/identity.repository';
import {
	identityRotationRepository,
	rotationRowToStatement
} from '$lib/repositories/identity-rotation.repository';
import { registryRepository } from '$lib/repositories/registry.repository';
import { outboxRepository } from '$lib/repositories/outbox.repository';
import { buildAegisBundleFromIdentity } from '$lib/utils/aegis-bundle.server';
import { seedHandler } from '$lib/services/seed-handler';
import { config } from '$lib/config';

export type RotationResult = {
	did: string;
	seq: number;
	newRoot: string;
	rotatedAt: string;
};

type UserIdInput = RecordId | string;

/**
 * Rotation Controller
 * Root-key rotation for the authenticated user's own DID. The DID is
 * genesis-key-derived and never changes; rotation appends a signed statement
 * to the per-DID chain and moves the identity's current root key.
 *
 * Rotation requires possession of the current root key: either the Aegis
 * password (custodial mode) or an external signer such as Syner
 * (self-custody mode). There are no recovery keys — a lost root key with no
 * Aegis bundle cannot be rotated away.
 */
export class RotationController {
	/**
	 * Custodial rotation: verify the password, decrypt the Aegis seed,
	 * generate a new root, sign the statement with the OLD key, then persist
	 * the chain row, move identity.public_key, re-wrap the NEW seed under
	 * Aegis(password), re-sign active delegations with the new root, and
	 * enqueue registry re-sync jobs. Rolls back on mid-flow failure.
	 */
	async rotateWithAegis(userId: UserIdInput, password: string): Promise<RotationResult> {
		const { identity, resolvedUserId } = await this.loadIdentity(userId);

		const bundle = buildAegisBundleFromIdentity(identity);
		if (!bundle) {
			throw new Error(
				'Identity has no custodial (Aegis) key storage. Use external mode with a self-custody signer.'
			);
		}

		await initCryptoWasm();
		const { chain, currentKey } = await this.loadVerifiedChain(identity);

		return seedHandler.run({
			bundle,
			password,
			action: async (seed) => {
				// The custodial seed must be the CURRENT root's private key.
				const seedPublicKey = derivePublicKeyFromSeed(seed);
				if (!constantTimeEqual(seedPublicKey, currentKey)) {
					throw new Error('Custodial seed does not match the current root key.');
				}

				const newKeypair = await generateRootKeypair();
				try {
					const statement = await createRotationStatement(
						identity.did,
						chain.length + 1,
						newKeypair.publicKey,
						seed
					);
					if (statement.prevRoot !== identity.public_key) {
						throw new Error('Rotation statement prevRoot does not match the stored root key.');
					}
					const newBundle = await createAegisBundle(newKeypair.privateKey, password);

					await this.persistRotation({
						identity,
						statement,
						resolvedUserId,
						newAegisBundle: newBundle,
						oldAegisBundle: bundle,
						newPrivateKey: newKeypair.privateKey
					});

					return {
						did: identity.did,
						seq: statement.seq,
						newRoot: statement.newRoot,
						rotatedAt: statement.rotatedAt
					};
				} finally {
					newKeypair.privateKey.fill(0);
				}
			}
		});
	}

	/**
	 * Self-custody rotation: the client (e.g. Syner) submits a fully-formed
	 * signed statement. The server validates it against the stored chain
	 * (seq = n+1, prevRoot = current root, valid signature, genesis linkage)
	 * and persists it; no server-side key material is involved. Delegations
	 * signed by the retired root are NOT re-signed — verifiers accept them
	 * when they were created before the retiring key's rotatedAt.
	 */
	async rotateExternal(userId: UserIdInput, statement: RotationStatement): Promise<RotationResult> {
		const { identity, resolvedUserId } = await this.loadIdentity(userId);

		if (statement.did !== identity.did) {
			throw new Error('Rotation statement DID does not match your identity.');
		}
		if (buildAegisBundleFromIdentity(identity)) {
			throw new Error(
				'Identity uses custodial (Aegis) key storage. Rotate with mode "aegis" or remove Aegis first.'
			);
		}

		await initCryptoWasm();
		const { chain } = await this.loadVerifiedChain(identity);

		const expectedSeq = chain.length + 1;
		if (statement.seq !== expectedSeq) {
			throw new Error(`Rotation statement seq must be ${expectedSeq}.`);
		}
		if (statement.prevRoot !== identity.public_key) {
			throw new Error('Rotation statement prevRoot does not match the current root key.');
		}
		// rotatedAt must survive datetime storage losslessly so the chain can
		// be re-verified from persisted rows byte-for-byte.
		const rotatedAtDate = new Date(statement.rotatedAt);
		if (
			Number.isNaN(rotatedAtDate.getTime()) ||
			rotatedAtDate.toISOString() !== statement.rotatedAt
		) {
			throw new Error(
				'rotatedAt must be an ISO-8601 UTC timestamp with millisecond precision (e.g. 2026-01-01T00:00:00.000Z).'
			);
		}

		// Full-chain validation: genesis linkage, prevRoot continuity, seq,
		// signature under the retiring key, non-decreasing rotatedAt.
		await verifyRotationChain(identity.did, [...chain, statement]);

		await this.persistRotation({
			identity,
			statement,
			resolvedUserId,
			newAegisBundle: null,
			oldAegisBundle: null,
			newPrivateKey: null
		});

		return {
			did: identity.did,
			seq: statement.seq,
			newRoot: statement.newRoot,
			rotatedAt: statement.rotatedAt
		};
	}

	private async loadIdentity(
		userId: UserIdInput
	): Promise<{ identity: Identity; resolvedUserId: RecordId }> {
		const resolvedUserId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
		const identity = await identityRepository.findByUserId(resolvedUserId);
		if (!identity) {
			throw new Error('User has no identity.');
		}
		return { identity, resolvedUserId };
	}

	/**
	 * Load and re-verify the stored chain, and confirm identity.public_key
	 * matches the chain's current root (detects tampered/stale state).
	 */
	private async loadVerifiedChain(
		identity: Identity
	): Promise<{ chain: RotationStatement[]; currentKey: Uint8Array }> {
		const rows = await identityRotationRepository.findChainByDid(identity.did);
		const chain = rows.map(rotationRowToStatement);
		const currentKey = await verifyRotationChain(identity.did, chain);
		if (!constantTimeEqual(currentKey, decodePublicKey(identity.public_key))) {
			throw new Error('Stored root key does not match the rotation chain.');
		}
		return { chain, currentKey };
	}

	/**
	 * Persist a validated rotation with a rollback ledger: every applied step
	 * pushes an undo action; on failure the ledger is unwound in reverse order.
	 *
	 * The core step — appending the chain row and advancing identity.public_key
	 * (+ re-wrapped Aegis for custodial) — is a single DB transaction, so a
	 * crash can never leave a chain tip ahead of the stored root key.
	 */
	private async persistRotation(params: {
		identity: Identity;
		statement: RotationStatement;
		resolvedUserId: RecordId;
		/** New-seed Aegis bundle (custodial rotation); null for external. */
		newAegisBundle: AegisBundle | null;
		/** Prior Aegis bundle restored on rollback (custodial); null for external. */
		oldAegisBundle: AegisBundle | null;
		/** New root private key (custodial mode) used to re-sign active delegations; null for external mode. */
		newPrivateKey: Uint8Array | null;
	}): Promise<void> {
		const { identity, statement, resolvedUserId, newAegisBundle, oldAegisBundle } = params;
		const rollback: Array<() => Promise<void>> = [];

		try {
			// Atomic: append the chain row AND advance identity.public_key
			// (+ Aegis columns for custodial) in one transaction.
			await identityRotationRepository.appendStatementAndAdvanceRoot({
				statement,
				identityId: identity.id,
				aegisBundle: newAegisBundle
			});
			rollback.push(() =>
				identityRotationRepository.revertRootAndDeleteStatement({
					did: identity.did,
					seq: statement.seq,
					identityId: identity.id,
					publicKey: identity.public_key,
					aegisBundle: oldAegisBundle
				})
			);

			if (params.newPrivateKey) {
				// Custodial rotation also re-signs active (non-revoked,
				// non-expired) delegations with the new root so verifiers that
				// only know the current key keep accepting them.
				const activeKeys = await delegatedKeyRepository.findActiveByDid(identity.did);
				for (const dk of activeKeys) {
					const canonicalDelegation = dk.canonical_delegation;
					if (!canonicalDelegation) continue;
					const previousSignature = dk.signature;
					const signatureBytes = await sign(canonicalDelegation, params.newPrivateKey);
					await delegatedKeyRepository.updateDelegationSignature(
						dk.id,
						canonicalDelegation,
						encodeMultibase(signatureBytes)
					);
					rollback.push(() =>
						delegatedKeyRepository.updateDelegationSignature(
							dk.id,
							canonicalDelegation,
							previousSignature
						)
					);
				}
			}

			// Re-sync every publication registry so the hosting record gets
			// re-signed under the new root (the signing flow attaches the
			// rotation chain when pushing to the registry).
			const registries = await registryRepository.findByDid(identity.did);
			for (const registry of registries) {
				const job = await outboxRepository.enqueue({
					type: 'registry_sync',
					payload: {
						action: 'update',
						did: identity.did,
						registryUrl: registry.registry_url,
						provider: config.PUBLIC_URL
					},
					userId: resolvedUserId
				});
				rollback.push(() => outboxRepository.cancel(job.id));
			}
		} catch (err) {
			console.error('[rotation.controller] Rotation persistence failed, rolling back:', err);
			for (const undo of rollback.reverse()) {
				try {
					await undo();
				} catch (rollbackErr) {
					console.error('[rotation.controller] Rollback step failed:', rollbackErr);
				}
			}
			throw err;
		}
	}
}

// Export singleton instance
export const rotationController = new RotationController();
