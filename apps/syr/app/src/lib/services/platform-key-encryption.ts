import { createAegisBundle, decryptAegisBundle } from '@syr-is/crypto/aegis';
import type { AegisBundle } from '@syr-is/crypto/aegis';
import { platformDelegation } from '$lib/config';

/**
 * Platform Key Encryption Service
 * Encrypts/decrypts platform delegate private keys using the server's
 * PLATFORM_DELEGATE_SECRET as the password for Aegis (CIGP) encryption.
 *
 * Unlike user Aegis bundles (encrypted with user password, decrypted client-side),
 * platform delegate keys are encrypted with a server-managed secret and decrypted
 * server-side on demand for signing requests. The decrypted key is zeroed after use.
 */

/**
 * Encrypt a platform delegate private key (32-byte Ed25519 seed).
 * Uses the same Aegis (CIGP) format as user identity encryption.
 */
export async function encryptDelegateKey(privateKey: Uint8Array): Promise<AegisBundle> {
	if (privateKey.length !== 32) {
		throw new Error('Platform delegate key must be 32 bytes');
	}
	return createAegisBundle(privateKey, platformDelegation.secret);
}

/**
 * Decrypt a platform delegate private key.
 * Returns the 32-byte Ed25519 seed. Caller MUST zero the returned array after use.
 */
export async function decryptDelegateKey(bundle: AegisBundle): Promise<Uint8Array> {
	return decryptAegisBundle(bundle, platformDelegation.secret);
}

/**
 * Execute an action with the decrypted delegate key, then zero it.
 * Preferred over raw decrypt to ensure cleanup.
 */
export async function withDelegateKey<T>(
	bundle: AegisBundle,
	action: (seed: Uint8Array) => Promise<T>
): Promise<T> {
	const seed = await decryptDelegateKey(bundle);
	try {
		return await action(seed);
	} finally {
		seed.fill(0);
	}
}
