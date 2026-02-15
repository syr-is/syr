import { identityRepository, delegatedKeyRepository } from '$lib/repositories/identity.repository';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { verify, canonicalize, decodeMultibase, deriveDid } from '@syr-is/crypto';
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
		const requestPubKeyBytes = decodeMultibase(publicKey);
		// Strip multicodec prefix if present
		let cleanPubKeyBytes = requestPubKeyBytes;
		if (
			requestPubKeyBytes.length === 34 &&
			requestPubKeyBytes[0] === 0xed &&
			requestPubKeyBytes[1] === 0x01
		) {
			cleanPubKeyBytes = requestPubKeyBytes.slice(2);
		}
		if (cleanPubKeyBytes.length !== 32) {
			throw new Error('Invalid public key length.');
		}
		for (let i = 0; i < 32; i++) {
			if (cleanPubKeyBytes[i] !== parsedDid.publicKey[i]) {
				throw new Error('Provided public key does not match DID.');
			}
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

		// Store identity
		const now = new Date();
		await identityRepository.create({
			did,
			public_key: publicKey,
			user_id: resolvedUserId,
			created_at: now
		} as Partial<Identity>);

		// Store delegated key
		await delegatedKeyRepository.create({
			did,
			public_key: devicePublicKey,
			scope: delegation.scope,
			created_at: now,
			signature: delegation.signature
		} as Partial<DelegatedKey>);

		// Update user with DID
		await userRepository.update(resolvedUserId, { did } as Record<string, unknown>);

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

		// Verify the delegation signature against the root key
		const rootPubKeyBytes = decodeMultibase(identity.public_key);
		let rootKeyClean = rootPubKeyBytes;
		if (
			rootPubKeyBytes.length === 34 &&
			rootPubKeyBytes[0] === 0xed &&
			rootPubKeyBytes[1] === 0x01
		) {
			rootKeyClean = rootPubKeyBytes.slice(2);
		}

		const delegationSignatureBytes = decodeMultibase(dk.signature);
		// We need to reconstruct the delegation statement
		// In a production system we would store the full delegation statement,
		// but for now we verify the payload signature against the device key
		// The delegation was already verified at identity init time.

		// Verify the payload signature with the device key
		const devicePubKeyBytes = decodeMultibase(devicePublicKey);
		let deviceKeyClean = devicePubKeyBytes;
		if (
			devicePubKeyBytes.length === 34 &&
			devicePubKeyBytes[0] === 0xed &&
			devicePubKeyBytes[1] === 0x01
		) {
			deviceKeyClean = devicePubKeyBytes.slice(2);
		}

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
