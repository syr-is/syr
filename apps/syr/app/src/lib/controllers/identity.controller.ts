import { identityRepository, delegatedKeyRepository } from '$lib/repositories/identity.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import {
	verify,
	canonicalize,
	decodeMultibase,
	decodePublicKey,
	deriveDid,
	constantTimeEqual,
	generateRootKeypair
} from '@syr-is/crypto';
import { createAegisBundle, type AegisBundle } from '@syr-is/crypto/aegis';
import { parseDid, buildDidDocument } from '@syr-is/did';
import { stringToRecordId } from '@syr-is/types';
import type { RecordId } from 'surrealdb';
import type {
	Identity,
	DelegatedKey,
	IdentityInitRequest,
	IdentityDelegateRequest,
	IdentityExportBundle
} from '@syr-is/types';
import { ensureDefaultIdentityHostUrl } from '$lib/server/ensure-default-identity-host-url.server';
import { getCurrentRootKey, getRotationChain } from '$lib/server/root-key.server';

type UserIdInput = RecordId | string;

/**
 * Extract the signed `createdAt` from a canonical delegation string (JCS JSON).
 * This value is covered by the delegation signature, so it is the trustworthy
 * source for the retired-root timestamp gate. Returns null when the field is
 * absent or unparseable so the gate fails closed rather than falling back to a
 * mutable DB column.
 */
function parseDelegationCreatedAt(canonicalDelegation: string): Date | null {
	try {
		const parsed = JSON.parse(canonicalDelegation) as { createdAt?: unknown };
		if (typeof parsed.createdAt !== 'string') return null;
		const date = new Date(parsed.createdAt);
		return Number.isNaN(date.getTime()) ? null : date;
	} catch {
		return null;
	}
}

/**
 * Identity Controller
 * Business logic for identity initialization, delegation verification,
 * signed mutations, and identity export.
 */
export class IdentityController {
	/**
	 * Initialize a new identity for a user.
	 * Called after the client generates root and device keypairs.
	 *
	 * Verifies the delegation signature, then stores:
	 * - identity record (DID + root public key)
	 * - delegated_key record (device public key + signature)
	 * - updates user record with DID
	 */
	async initializeIdentity(
		userId: UserIdInput,
		request: IdentityInitRequest
	): Promise<{ did: string }> {
		const { did, publicKey, devicePublicKey, delegation } = request;

		// Verify the DID matches the public key
		const parsedDid = parseDid(did);
		const derivedDid = deriveDid(parsedDid.publicKey);
		if (derivedDid !== did) {
			throw new Error('DID does not match the provided public key.');
		}

		// Verify the public key in the request matches the DID
		const requestPubKeyBytes = decodePublicKey(publicKey);
		if (!constantTimeEqual(requestPubKeyBytes, parsedDid.publicKey)) {
			throw new Error('Provided public key does not match DID.');
		}

		// Resolve userId to RecordId if string
		const resolvedUserId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;

		// Check user does not already have an identity
		const existingIdentity = await identityRepository.findByUserId(resolvedUserId);
		if (existingIdentity) {
			throw new Error('User already has an identity.');
		}

		// Verify delegation signature
		await this.verifyDelegationSignature(delegation, parsedDid.publicKey);

		// Ensure the delegation statement refers to this identity. Otherwise we would store
		// identity/delegated_key with request did while canonical_delegation would contain
		// delegation.did, causing verifySignedMutation (which uses dk.did and dk.canonical_delegation)
		// to have inconsistent data and signature verification failures.
		if (delegation.did !== did) {
			throw new Error('Delegation DID does not match the request DID.');
		}

		// Ensure the delegation authorizes this device key. Otherwise a tampered request could
		// pair a valid delegation (for key B) with a different devicePublicKey (key A), storing
		// key A as delegated while canonical_delegation contains delegation.delegate (key B), so
		// verifySignedMutation would have inconsistent dk.public_key vs canonical_delegation.
		const delegateBytes = decodePublicKey(delegation.delegate);
		const devicePubKeyBytes = decodePublicKey(devicePublicKey);
		if (!constantTimeEqual(delegateBytes, devicePubKeyBytes)) {
			throw new Error('Delegation does not authorize the provided device key.');
		}

		// Canonical delegation string (exact bytes the client signed) for storage and re-verification
		const canonicalDelegation = canonicalize({
			did: delegation.did,
			delegate: delegation.delegate,
			scope: delegation.scope,
			createdAt: delegation.createdAt,
			...(delegation.expiresAt ? { expiresAt: delegation.expiresAt } : {})
		});

		const now = new Date();
		const delegationCreatedAt = new Date(delegation.createdAt);
		const delegationExpiresAt = delegation.expiresAt ? new Date(delegation.expiresAt) : undefined;

		try {
			await identityRepository.createIdentityWithDelegationAndUserUpdate({
				did,
				publicKey,
				userId: resolvedUserId,
				now,
				devicePublicKey,
				scope: delegation.scope,
				delegationCreatedAt,
				delegationExpiresAt,
				signature: delegation.signature,
				canonicalDelegation
			});
		} catch (err) {
			if (IdentityController.isUniqueConstraintError(err)) {
				throw new Error('User already has an identity.');
			}
			throw err;
		}

		await ensureDefaultIdentityHostUrl(resolvedUserId, did);

		return { did };
	}

	/**
	 * Create an identity with Aegis (password-protected seed).
	 * Called at registration when the password is available.
	 * The server generates the root keypair, creates an Aegis bundle,
	 * and stores the encrypted seed (no raw private key).
	 *
	 * @param userId - The user to create the identity for
	 * @param password - The user's password (used to encrypt the seed)
	 * @param tenantId - Optional tenant to scope the identity to
	 * @returns The generated DID, public key, and Aegis bundle (for client decryption)
	 */
	async createIdentityAegis(
		userId: UserIdInput,
		password: string,
		tenantId?: RecordId | string
	): Promise<{ did: string; publicKey: string; aegisBundle: AegisBundle }> {
		const resolvedUserId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;

		// Check user does not already have an identity
		const existingIdentity = await identityRepository.findByUserId(resolvedUserId);
		if (existingIdentity) {
			throw new Error('User already has an identity.');
		}

		// Generate root keypair and create Aegis bundle
		const rootKeypair = await generateRootKeypair();
		const bundle = await createAegisBundle(rootKeypair.privateKey, password);
		const did = deriveDid(rootKeypair.publicKey);

		const now = new Date();

		try {
			await identityRepository.createIdentityAegis({
				did,
				publicKey: bundle.pub,
				aegisBundle: bundle,
				userId: resolvedUserId,
				tenantId: tenantId
					? typeof tenantId === 'string'
						? stringToRecordId.decode(tenantId)
						: tenantId
					: undefined,
				now
			});
		} catch (err) {
			if (IdentityController.isUniqueConstraintError(err)) {
				throw new Error('User already has an identity.');
			}
			throw err;
		}

		return { did, publicKey: bundle.pub, aegisBundle: bundle };
	}

	/**
	 * Check if error is a SurrealDB unique constraint violation (e.g. concurrent identity creation).
	 */
	private static isUniqueConstraintError(error: unknown): boolean {
		if (error && typeof error === 'object') {
			if ('code' in error && (error as { code: string }).code === 'UNIQUE_CONSTRAINT_VIOLATION') {
				return true;
			}
			if ('message' in error) {
				const errorMessage = (error as { message: string }).message;
				return (
					errorMessage.includes('duplicate') ||
					errorMessage.includes('unique') ||
					errorMessage.includes('already exists')
				);
			}
		}
		return false;
	}

	/**
	 * Verify a delegation signature.
	 * The delegation statement is canonicalized and its signature is verified
	 * against the root public key.
	 */
	async verifyDelegationSignature(
		delegation: IdentityInitRequest['delegation'],
		rootPublicKey: Uint8Array
	): Promise<void> {
		const statement = canonicalize({
			did: delegation.did,
			delegate: delegation.delegate,
			scope: delegation.scope,
			createdAt: delegation.createdAt,
			...(delegation.expiresAt ? { expiresAt: delegation.expiresAt } : {})
		});

		const signatureBytes = decodeMultibase(delegation.signature);

		const isValid = await verify(statement, signatureBytes, rootPublicKey);
		if (!isValid) {
			throw new Error('Invalid delegation signature.');
		}
	}

	/**
	 * Verify a signed mutation payload.
	 *
	 * Steps:
	 * 1. Look up the device key
	 * 2. Verify the device key is delegated and active
	 * 3. Verify the delegation was signed by the root key
	 * 4. Verify the payload signature
	 */
	async verifySignedMutation(
		payload: Record<string, unknown>,
		signature: string,
		devicePublicKey: string
	): Promise<{ identity: Identity; delegatedKey: DelegatedKey }> {
		// Look up the delegated key
		const dk = await delegatedKeyRepository.findByPublicKey(devicePublicKey);
		if (!dk) {
			throw new Error('Device key not found.');
		}

		// Check revocation
		if (dk.revoked_at) {
			throw new Error('Device key has been revoked.');
		}

		// Check expiration
		if (dk.expires_at && new Date() > dk.expires_at) {
			throw new Error('Device key has expired.');
		}

		// Look up the identity
		const identity = await identityRepository.findByDid(dk.did);
		if (!identity) {
			throw new Error('Identity not found for delegated key.');
		}

		// Re-verify the delegation signature on every mutation.
		// This prevents an attacker with DB write access from inserting a malicious
		// delegated_key and having it accepted without the root key's signature.
		// Use the stored canonical delegation string (exact bytes the client signed)
		// so verify() matches; reconstructing from DB fields would be fragile.
		const canonicalDelegation = dk.canonical_delegation;
		if (!canonicalDelegation) {
			throw new Error('Delegation record is missing canonical statement.');
		}
		const delegationValid = await this.verifyDelegationRootSignature(
			identity,
			dk,
			canonicalDelegation
		);
		if (!delegationValid) {
			throw new Error('Delegation signature invalid. Device key is not authorized by root.');
		}

		// Verify the payload signature with the device key
		const deviceKeyClean = decodePublicKey(devicePublicKey);

		const canonicalPayload = canonicalize(payload);
		const sigBytes = decodeMultibase(signature);

		const isValid = await verify(canonicalPayload, sigBytes, deviceKeyClean);
		if (!isValid) {
			throw new Error('Invalid payload signature.');
		}

		return { identity, delegatedKey: dk };
	}

	/**
	 * Verify a delegation's root signature under the rotation-chain policy:
	 * - valid when signed by the CURRENT root key (custodial rotation re-signs
	 *   active delegations, so this is the common case), or
	 * - valid when signed by a RETIRED root key, provided the delegation was
	 *   created before that key's rotatedAt (the key was still the root when
	 *   it authorized the delegate). Self-custody (external) rotation cannot
	 *   re-sign server-side, so its pre-rotation delegations rely on this.
	 *
	 * The current key AND every retired key are resolved from a FULLY
	 * RE-VERIFIED rotation chain via getCurrentRootKey (link, seq, signatures,
	 * timestamps re-checked, each prev_root cryptographically linked back to the
	 * DID-derived genesis). This is the same trust anchor every other
	 * root-signature verifier in the app uses; resolving retired keys from raw
	 * identity_rotation rows would let a DB-write attacker plant an unsigned row
	 * whose prev_root anchors a forged delegation. getCurrentRootKey throws if
	 * any stored row is tampered/unsigned, so such a chain is rejected before
	 * any key it contains can be trusted.
	 */
	private async verifyDelegationRootSignature(
		identity: Identity,
		dk: DelegatedKey,
		canonicalDelegation: string
	): Promise<boolean> {
		const signatureBytes = decodeMultibase(dk.signature);

		const { publicKey: currentRootKey, chain } = await getCurrentRootKey(identity.did);
		if (await verify(canonicalDelegation, signatureBytes, currentRootKey)) {
			return true;
		}

		// Gate retired-root validity on the signed createdAt embedded in the
		// canonical delegation (covered by the delegation signature we are about
		// to verify), not the mutable dk.created_at DB column an attacker with
		// DB-write access could backdate.
		const delegationCreatedAt = parseDelegationCreatedAt(canonicalDelegation);
		if (delegationCreatedAt === null) return false;
		for (const statement of chain) {
			const rotatedAt = new Date(statement.rotatedAt);
			if (!(delegationCreatedAt < rotatedAt)) continue;
			const retiredKey = decodePublicKey(statement.prevRoot);
			if (await verify(canonicalDelegation, signatureBytes, retiredKey)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Verify a signed content mutation using either a delegated device key or the identity root key
	 * (multibase in `devicePublicKey` must match a delegated row, or exactly `identity.public_key` for root-only / Aegis flows).
	 */
	async verifyClientSignedContent(
		identity: Identity,
		payload: Record<string, unknown>,
		signature: string,
		devicePublicKey: string
	): Promise<void> {
		if (devicePublicKey === identity.public_key) {
			const rootKeyClean = decodePublicKey(identity.public_key);
			const canonicalPayload = canonicalize(payload);
			const sigBytes = decodeMultibase(signature);
			const isValid = await verify(canonicalPayload, sigBytes, rootKeyClean);
			if (!isValid) {
				throw new Error('Invalid payload signature.');
			}
			return;
		}

		const dk = await delegatedKeyRepository.findByPublicKey(devicePublicKey);
		if (dk) {
			const { identity: verifiedIdentity } = await this.verifySignedMutation(
				payload,
				signature,
				devicePublicKey
			);
			if (verifiedIdentity.did !== identity.did) {
				throw new Error('Signing key is not authorized for this identity.');
			}
			return;
		}

		throw new Error('Device key not found.');
	}

	/**
	 * Check if a user has an identity.
	 */
	async hasIdentity(userId: UserIdInput): Promise<boolean> {
		const resolvedUserId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
		const identity = await identityRepository.findByUserId(resolvedUserId);
		return identity !== null;
	}

	/**
	 * Get identity for a user.
	 */
	async getIdentity(userId: UserIdInput): Promise<Identity | null> {
		const resolvedUserId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
		return identityRepository.findByUserId(resolvedUserId);
	}

	/**
	 * Add a delegated device key to an existing identity.
	 */
	async delegateIdentity(
		userId: UserIdInput,
		request: IdentityDelegateRequest
	): Promise<{ did: string }> {
		const { did, devicePublicKey, delegation } = request;
		const resolvedUserId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;

		const identity = await identityRepository.findByDid(did);
		if (!identity) throw new Error('Identity not found.');
		const identityUserId = identity.user_id.toString();
		const requestedUserId =
			typeof resolvedUserId === 'string' ? resolvedUserId : resolvedUserId.toString();
		if (identityUserId !== requestedUserId)
			throw new Error('Identity does not belong to this user.');

		const rootKeyBytes = decodePublicKey(identity.public_key);
		await this.verifyDelegationSignature(delegation, rootKeyBytes);

		if (delegation.did !== did) throw new Error('Delegation DID does not match the request DID.');
		const delegateBytes = decodePublicKey(delegation.delegate);
		const devicePubKeyBytes = decodePublicKey(devicePublicKey);
		if (!constantTimeEqual(delegateBytes, devicePubKeyBytes)) {
			throw new Error('Delegation does not authorize the provided device key.');
		}

		const existingKey = await delegatedKeyRepository.findByPublicKey(devicePublicKey);
		if (existingKey && !existingKey.revoked_at) {
			throw new Error('This device key is already delegated.');
		}

		const canonicalDelegation = canonicalize({
			did: delegation.did,
			delegate: delegation.delegate,
			scope: delegation.scope,
			createdAt: delegation.createdAt,
			...(delegation.expiresAt ? { expiresAt: delegation.expiresAt } : {})
		});
		const delegationCreatedAt = new Date(delegation.createdAt);
		const delegationExpiresAt = delegation.expiresAt ? new Date(delegation.expiresAt) : undefined;

		await delegatedKeyRepository.createDelegatedKey({
			did,
			publicKey: devicePublicKey,
			scope: delegation.scope,
			createdAt: delegationCreatedAt,
			expiresAt: delegationExpiresAt,
			signature: delegation.signature,
			canonicalDelegation
		});

		return { did };
	}

	/**
	 * Revoke a delegated key. Caller must verify ownership.
	 */
	async revokeDelegatedKey(userId: UserIdInput, devicePublicKey: string): Promise<void> {
		const dk = await delegatedKeyRepository.findByPublicKey(devicePublicKey);
		if (!dk) throw new Error('Delegated key not found.');
		const identity = await identityRepository.findByDid(dk.did);
		if (!identity) throw new Error('Identity not found.');
		const resolvedUserId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
		const identityUserId = identity.user_id.toString();
		const requestedUserId =
			typeof resolvedUserId === 'string' ? resolvedUserId : resolvedUserId.toString();
		if (identityUserId !== requestedUserId)
			throw new Error('Delegated key does not belong to this user.');
		if (dk.revoked_at) throw new Error('Delegated key is already revoked.');
		const activeKeys = await delegatedKeyRepository.findActiveByDid(dk.did);
		if (activeKeys.length <= 1) throw new Error('Cannot revoke your only active device key.');
		await delegatedKeyRepository.revoke(dk.id);
	}

	/**
	 * Get delegated keys for a user's identity.
	 */
	async getDelegatedKeys(userId: UserIdInput): Promise<
		Array<{
			publicKey: string;
			scope: string;
			createdAt: string;
			expiresAt?: string;
			revokedAt?: string;
		}>
	> {
		const identity = await this.getIdentity(userId);
		if (!identity) return [];
		const keys = await delegatedKeyRepository.findByDid(identity.did);
		return keys.map((k) => ({
			publicKey: k.public_key,
			scope: k.scope,
			createdAt: k.created_at.toISOString(),
			expiresAt: k.expires_at?.toISOString(),
			revokedAt: k.revoked_at?.toISOString()
		}));
	}

	/**
	 * Export identity bundle.
	 * Returns all portable identity data (never includes private keys).
	 */
	async exportIdentity(userId: UserIdInput): Promise<IdentityExportBundle> {
		const resolvedUserId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
		const identity = await identityRepository.findByUserId(resolvedUserId);
		if (!identity) {
			throw new Error('User has no identity.');
		}

		const delegatedKeys = await delegatedKeyRepository.findByDid(identity.did);
		const profile = await profileRepository.findByUserId(resolvedUserId);
		if (!profile) {
			throw new Error('User has no profile.');
		}

		// Embed the full rotation chain so the exported bundle is self-verifying: an
		// importer resolves the current root via verifyRotationChain(did, chain)
		// without access to this instance's identity_rotation table.
		const rotationChain = await getRotationChain(identity.did);

		return {
			did: identity.did,
			publicKey: identity.public_key,
			didDocument: buildDidDocument({
				did: identity.did,
				publicKeyMultibase: identity.public_key
				// TODO: serviceEndpoint should be dynamically determined based on instance URL
				// For now omitting it or we can pass a default if needed
			}) as unknown as Record<string, unknown>,
			delegatedKeys: delegatedKeys.map((dk) => ({
				publicKey: dk.public_key,
				scope: dk.scope as 'device' | 'session',
				createdAt: dk.created_at.toISOString(),
				expiresAt: dk.expires_at?.toISOString(),
				revokedAt: dk.revoked_at?.toISOString(),
				signature: dk.signature
			})),
			profile: {
				displayName: profile.display_name,
				bio: profile.bio,
				avatarUrl: profile.avatar_url,
				bannerUrl: profile.banner_url,
				identityHostUrl: profile.identity_host_url
			},
			...(rotationChain.length > 0 && { rotationChain }),
			exportedAt: new Date().toISOString()
		};
	}
}

// Export singleton instance
export const identityController = new IdentityController();
