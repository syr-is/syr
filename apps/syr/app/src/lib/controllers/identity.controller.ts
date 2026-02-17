import { identityRepository, delegatedKeyRepository } from '$lib/repositories/identity.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import {
	verify,
	canonicalize,
	decodeMultibase,
	decodePublicKey,
	deriveDid,
	constantTimeEqual,
	generateRootKeypair,
	encodeMultibase,
	concatBytes,
	ED25519_MULTICODEC_PREFIX
} from '@syr-is/crypto';
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

		return { did };
	}

	/**
	 * Create an identity server-side (no client crypto required).
	 * The server generates the root keypair, derives the DID,
	 * and stores the encrypted private key.
	 *
	 * @param userId - The user to create the identity for
	 * @param tenantId - Optional tenant to scope the identity to
	 * @returns The generated DID and public key
	 */
	async createIdentityServerSide(
		userId: UserIdInput,
		tenantId?: RecordId | string
	): Promise<{ did: string; publicKey: string }> {
		const resolvedUserId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;

		// Check user does not already have an identity
		const existingIdentity = await identityRepository.findByUserId(resolvedUserId);
		if (existingIdentity) {
			throw new Error('User already has an identity.');
		}

		// Generate root keypair server-side
		const rootKeypair = await generateRootKeypair();
		const did = deriveDid(rootKeypair.publicKey);

		// Encode public key as multibase
		const pubKeyMultibase = encodeMultibase(
			concatBytes(ED25519_MULTICODEC_PREFIX, rootKeypair.publicKey)
		);

		// Encode private key as multibase (same format as public key for consistency)
		const privateKeyMultibase = encodeMultibase(
			concatBytes(ED25519_MULTICODEC_PREFIX, rootKeypair.privateKey)
		);

		const now = new Date();

		// Create identity record with private key
		try {
			await identityRepository.createIdentityServerSide({
				did,
				publicKey: pubKeyMultibase,
				privateKey: privateKeyMultibase,
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

		return { did, publicKey: pubKeyMultibase };
	}

	/**
	 * Export private key for a user's identity.
	 * Only returns the key if the identity was created with server-side key generation.
	 * After export, the user is responsible for key custody.
	 */
	async exportKeys(
		userId: UserIdInput
	): Promise<{ did: string; privateKey: string; publicKey: string }> {
		const resolvedUserId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
		const identity = await identityRepository.findByUserId(resolvedUserId);
		if (!identity) {
			throw new Error('User has no identity.');
		}
		if (!identity.private_key) {
			throw new Error(
				'Identity was not created with server-managed keys. Private key was never stored.'
			);
		}

		return {
			did: identity.did,
			privateKey: identity.private_key,
			publicKey: identity.public_key
		};
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
		const rootKeyClean = decodePublicKey(identity.public_key);

		const canonicalDelegation = dk.canonical_delegation;
		if (!canonicalDelegation) {
			throw new Error('Delegation record is missing canonical statement.');
		}
		const delegationValid = await verify(
			canonicalDelegation,
			decodeMultibase(dk.signature),
			rootKeyClean
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
				bannerUrl: profile.banner_url
			},
			exportedAt: new Date().toISOString()
		};
	}
}

// Export singleton instance
export const identityController = new IdentityController();
