import { initCryptoWasm, sign, canonicalize, encodeMultibase } from '@syr-is/crypto';

/**
 * Sign a canonical JCS payload with an Ed25519 private key (32-byte seed or PKCS8 from decodePrivateKey).
 * Returns multibase-encoded signature for `signed_mutation.signature`.
 */
export async function signMutationPayload(
	payload: Record<string, unknown>,
	privateKeyBytes: Uint8Array
): Promise<string> {
	await initCryptoWasm();
	const message = canonicalize(payload);
	const sig = await sign(message, privateKeyBytes);
	return encodeMultibase(sig);
}
