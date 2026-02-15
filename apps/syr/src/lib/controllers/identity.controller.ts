import { identityRepository, delegatedKeyRepository } from '$lib/repositories/identity.repository';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import {
	verify,
	canonicalize,
	decodeMultibase,
	deriveDid,
	constantTimeEqual,
	ED25519_MULTICODEC_PREFIX
} from '@syr-is/crypto';
import { parseDid } from '@syr-is/did';
import { stringToRecordId } from '@syr-is/types';
import type { RecordId } from 'surrealdb';
import type {
	Identity,
	DelegatedKey,
	IdentityInitRequest,
	IdentityExportBundle
} from '@syr-is/types';

type UserIdInput = RecordId | string;

/**
 * Strip Ed25519 multicodec prefix (0xed 0x01) from multibase-decoded bytes.
 * Accepts 34 bytes (2-byte prefix + 32-byte key) or 32 raw bytes; returns 32-byte public key.
 * @throws If length is not 34 (with correct prefix) or 32.
 */
function stripMulticodecPrefix(bytes: Uint8Array): Uint8Array {
	let raw: Uint8Array = bytes;
	if (
		bytes.length === 34 &&
		bytes[0] === ED25519_MULTICODEC_PREFIX[0] &&
		bytes[1] === ED25519_MULTICODEC_PREFIX[1]
	) {
		raw = bytes.slice(2);
	}
	if (raw.length !== 32) {
		throw new Error(
			`Invalid public key length: expected 32 bytes (Ed25519), got ${raw.length} after decoding.`
		);
	}
	return raw;
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
		const requestPubKeyBytes = stripMulticodecPrefix(decodeMultibase(publicKey));
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

		// Single transactional boundary: create identity, delegated_key, update user.
		// No SurrealDB transaction API in use here; use compensating cleanup on failure.
		const now = new Date();

		const createdIdentity = await identityRepository.create({
			did,
			public_key: publicKey,
			user_id: resolvedUserId,
			created_at: now
		} as Partial<Identity>);

		let createdDelegatedKey: DelegatedKey | null = null;
		try {
			createdDelegatedKey = await delegatedKeyRepository.create({
				did,
				public_key: devicePublicKey,
				scope: delegation.scope,
				created_at: now,
				signature: delegation.signature
			} as Partial<DelegatedKey>);
		} catch (err) {
			await identityRepository.delete(createdIdentity.id);
			throw err;
		}

		try {
			await userRepository.update(resolvedUserId, { did } as Record<string, unknown>);
		} catch (err) {
			await delegatedKeyRepository.delete(createdDelegatedKey.id);
			await identityRepository.delete(createdIdentity.id);
			throw err;
		}

		return { did };
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
		const rootKeyClean = stripMulticodecPrefix(decodeMultibase(identity.public_key));

		const delegationStatement = {
			did: dk.did,
			delegate: dk.public_key,
			scope: dk.scope,
			createdAt: dk.created_at.toISOString(),
			...(dk.expires_at ? { expiresAt: dk.expires_at.toISOString() } : {})
		};
		const canonicalDelegation = canonicalize(delegationStatement);
		const delegationValid = await verify(
			canonicalDelegation,
			decodeMultibase(dk.signature),
			rootKeyClean
		);
		if (!delegationValid) {
			throw new Error('Delegation signature invalid. Device key is not authorized by root.');
		}

		// Verify the payload signature with the device key
		const deviceKeyClean = stripMulticodecPrefix(decodeMultibase(devicePublicKey));

		const canonicalPayload = canonicalize(payload);
		const sigBytes = decodeMultibase(signature);

		const isValid = await verify(canonicalPayload, sigBytes, deviceKeyClean);
		if (!isValid) {
			throw new Error('Invalid payload signature.');
		}

		return { identity, delegatedKey: dk };
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

		return {
			did: identity.did,
			publicKey: identity.public_key,
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
				bannerUrl: profile.banner_url
			},
			exportedAt: new Date().toISOString()
		};
	}
}

// Export singleton instance
export const identityController = new IdentityController();
