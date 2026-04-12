import { identityRepository, delegatedKeyRepository } from '$lib/repositories/identity.repository';
import {
	generateDeviceKeypair,
	sign,
	canonicalize,
	encodeMultibase,
	ED25519_MULTICODEC_PREFIX
} from '@syr-is/crypto';
import { encryptDelegateKey, withDelegateKey } from '$lib/services/platform-key-encryption';
import { seedHandler } from '$lib/services/seed-handler';
import { stringToRecordId } from '@syr-is/types';
import type { Identity, AegisBundle } from '@syr-is/types';
import type { RecordId } from 'surrealdb';

type UserIdInput = RecordId | string;

/**
 * Platform Delegation Controller
 * Business logic for platform delegation: creating delegate keys,
 * signing-as-a-service, challenge-based re-login, and revocation.
 */
export class PlatformDelegationController {
	/**
	 * Create a platform delegation for a user.
	 * Generates a new Ed25519 delegate keypair, encrypts the private key,
	 * and stores it with the delegation.
	 *
	 * @param rootSignFn - Function that signs the delegation statement with the root key.
	 *                     For Aegis users, this decrypts the root key with the password.
	 *                     For Syner users, the signature is provided directly.
	 */
	async createPlatformDelegation(params: {
		userId: UserIdInput;
		did: string;
		platformOrigin: string;
		platformName: string;
		rootSignFn: (delegationStatement: string) => Promise<Uint8Array>;
	}): Promise<{ delegatePublicKey: string }> {
		const { userId, did, platformOrigin, platformName, rootSignFn } = params;
		const resolvedUserId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;

		// Verify identity exists
		const identity = await identityRepository.findByUserId(resolvedUserId);
		if (!identity) throw new Error('User has no identity.');
		if (identity.did !== did) throw new Error('DID does not match user identity.');

		// Reuse existing active platform delegation
		const existing = await delegatedKeyRepository.findByDidAndPlatformOrigin(did, platformOrigin);
		if (existing) {
			return { delegatePublicKey: existing.public_key };
		}

		// Generate delegate keypair
		const delegateKeypair = await generateDeviceKeypair();
		const delegatePublicKeyMultibase = encodeMultibase(
			new Uint8Array([...ED25519_MULTICODEC_PREFIX, ...delegateKeypair.publicKey])
		);

		// Create delegation statement
		const now = new Date();
		const delegationStatement = {
			did,
			delegate: delegatePublicKeyMultibase,
			scope: 'platform' as const,
			createdAt: now.toISOString()
		};
		const canonicalDelegation = canonicalize(delegationStatement);

		// Sign the delegation with the root key
		const signatureBytes = await rootSignFn(canonicalDelegation);
		const signatureMultibase = encodeMultibase(signatureBytes);

		// Encrypt the delegate private key for server-side storage
		const aegisDelegate = await encryptDelegateKey(delegateKeypair.privateKey);

		// Zero the raw private key
		delegateKeypair.privateKey.fill(0);

		// Store the delegation
		try {
			const dk = await delegatedKeyRepository.createPlatformDelegatedKey({
				did,
				publicKey: delegatePublicKeyMultibase,
				platformOrigin,
				platformName,
				aegisDelegate,
				createdAt: now,
				signature: signatureMultibase,
				canonicalDelegation
			});
			console.log('[platform-delegation] Created delegated_key:', {
				id: dk.id?.toString(),
				did,
				platformOrigin,
				scope: dk.scope
			});
		} catch (err) {
			console.error('[platform-delegation] Failed to create delegated_key:', err);
			throw err;
		}

		return { delegatePublicKey: delegatePublicKeyMultibase };
	}

	/**
	 * Create a root signing function for Aegis users.
	 * Decrypts the root key with the user's password, signs, then zeroes.
	 */
	createAegisRootSignFn(
		identity: Identity,
		password: string
	): (statement: string) => Promise<Uint8Array> {
		return async (statement: string) => {
			const aegisBundle: AegisBundle = {
				pub: identity.public_key,
				salt: identity.aegis_salt!,
				nonce: identity.aegis_nonce!,
				ct: identity.aegis_ct!,
				tag: identity.aegis_tag!,
				kdf: {
					mem: identity.aegis_kdf_mem!,
					it: identity.aegis_kdf_it!,
					par: identity.aegis_kdf_par!
				}
			};

			return seedHandler.run({
				bundle: aegisBundle,
				password,
				action: async (seed) => {
					return sign(statement, seed);
				}
			});
		};
	}

	/**
	 * Sign content with a platform delegation key (signing-as-a-service).
	 */
	async signContent(
		did: string,
		platformOrigin: string,
		payload: Record<string, unknown>
	): Promise<{
		signature: string;
		delegate_public_key: string;
		did: string;
		signed_at: string;
	}> {
		const dk = await delegatedKeyRepository.findByDidAndPlatformOrigin(did, platformOrigin);
		if (!dk) throw new Error('No active platform delegation found.');
		if (dk.revoked_at) throw new Error('Platform delegation has been revoked.');
		if (dk.expires_at && new Date() > dk.expires_at) {
			throw new Error('Platform delegation has expired.');
		}
		if (!dk.aegis_delegate) {
			throw new Error('Platform delegation is missing encrypted key.');
		}

		const canonicalPayload = canonicalize(payload);

		const signatureMultibase = await withDelegateKey(
			dk.aegis_delegate as AegisBundle,
			async (seed) => {
				const sig = await sign(canonicalPayload, seed);
				return encodeMultibase(sig);
			}
		);

		return {
			signature: signatureMultibase,
			delegate_public_key: dk.public_key,
			did: dk.did,
			signed_at: new Date().toISOString()
		};
	}

	/**
	 * Sign a challenge for platform re-login.
	 */
	async signChallenge(
		did: string,
		platformOrigin: string,
		challenge: string
	): Promise<{
		signature: string;
		delegate_public_key: string;
		did: string;
	}> {
		const dk = await delegatedKeyRepository.findByDidAndPlatformOrigin(did, platformOrigin);
		if (!dk) throw new Error('No active platform delegation found.');
		if (dk.revoked_at) throw new Error('Platform delegation has been revoked.');
		if (!dk.aegis_delegate) {
			throw new Error('Platform delegation is missing encrypted key.');
		}

		const signatureMultibase = await withDelegateKey(
			dk.aegis_delegate as AegisBundle,
			async (seed) => {
				const sig = await sign(challenge, seed);
				return encodeMultibase(sig);
			}
		);

		return {
			signature: signatureMultibase,
			delegate_public_key: dk.public_key,
			did: dk.did
		};
	}

	/**
	 * Revoke a platform delegation.
	 */
	async revokeDelegation(userId: UserIdInput, platformOrigin: string): Promise<void> {
		const resolvedUserId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
		const identity = await identityRepository.findByUserId(resolvedUserId);
		if (!identity) throw new Error('User has no identity.');

		const dk = await delegatedKeyRepository.findByDidAndPlatformOrigin(
			identity.did,
			platformOrigin
		);
		if (!dk) throw new Error('No platform delegation found for this origin.');
		if (dk.revoked_at) throw new Error('Platform delegation is already revoked.');

		await delegatedKeyRepository.revoke(dk.id);
	}

	/**
	 * Get all platform delegations for a DID (public info, no private keys).
	 */
	async getDelegations(did: string): Promise<
		Array<{
			delegate_public_key: string;
			platform_origin: string;
			platform_name: string;
			scope: string;
			created_at: string;
			revoked_at?: string;
			expires_at?: string;
		}>
	> {
		const keys = await delegatedKeyRepository.findPlatformDelegationsByDid(did);
		return keys.map((k) => ({
			delegate_public_key: k.public_key,
			platform_origin: k.platform_origin!,
			platform_name: k.platform_name || 'Unknown',
			scope: k.scope,
			created_at: k.created_at.toISOString(),
			revoked_at: k.revoked_at?.toISOString(),
			expires_at: k.expires_at?.toISOString()
		}));
	}

	/**
	 * Get platform delegations for a user (management view).
	 */
	async getDelegationsForUser(userId: UserIdInput): Promise<
		Array<{
			delegate_public_key: string;
			platform_origin: string;
			platform_name: string;
			scope: string;
			created_at: string;
			revoked_at?: string;
			expires_at?: string;
		}>
	> {
		const resolvedUserId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
		const identity = await identityRepository.findByUserId(resolvedUserId);
		if (!identity) return [];
		return this.getDelegations(identity.did);
	}
}

export const platformDelegationController = new PlatformDelegationController();
