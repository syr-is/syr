import { initCryptoWasm, verifyRotationChain } from '@syr-is/crypto';
import { parseDid } from '@syr-is/did';
import type { RotationStatement } from '@syr-is/types';
import {
	identityRotationRepository,
	rotationRowToStatement
} from '$lib/repositories/identity-rotation.repository';

export type CurrentRootKey = {
	/** Raw 32-byte current root public key (genesis when the chain is empty). */
	publicKey: Uint8Array;
	/** Ordered rotation chain for the DID (empty when never rotated). */
	chain: RotationStatement[];
};

/**
 * Load the ordered rotation chain for a DID from the local identity_rotation
 * table as wire-format statements.
 */
export async function getRotationChain(did: string): Promise<RotationStatement[]> {
	const rows = await identityRotationRepository.findChainByDid(did);
	return rows.map(rotationRowToStatement);
}

/**
 * Resolve the CURRENT root key for a DID: genesis key derived from the DID
 * plus the locally stored rotation chain, fully re-verified (link, seq,
 * signatures, timestamps) on every call so tampered chain rows are detected.
 *
 * This is the single trust anchor for root-signature verification. Never use
 * `parseDid(did).publicKey` directly to verify a root signature — that is the
 * genesis key, which may have been rotated away.
 *
 * @throws {Error} When the stored chain fails verification.
 */
export async function getCurrentRootKey(did: string): Promise<CurrentRootKey> {
	await initCryptoWasm();
	const chain = await getRotationChain(did);
	if (chain.length === 0) {
		return { publicKey: parseDid(did).publicKey, chain };
	}
	const publicKey = await verifyRotationChain(did, chain);
	return { publicKey, chain };
}
