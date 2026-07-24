import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { encodeMultibase, ED25519_MULTICODEC_PREFIX } from '@syr-is/crypto';
import { identityRepository } from '$lib/repositories/identity.repository';
import { getCurrentRootKey } from '$lib/server/root-key.server';

/**
 * GET /api/identity/[did]/rotations
 *
 * Returns the ordered root-key rotation chain for the given did:syr
 * identifier (seq 1..n; empty array when the identity has never rotated).
 * Public endpoint — no authentication required. Verifiers replay the chain
 * from the DID-derived genesis key to resolve the CURRENT root key.
 */
export const GET: RequestHandler = async ({ params }) => {
	const { did } = params;

	if (!did || !did.startsWith('did:syr:')) {
		throw error(400, 'Invalid DID format. Must start with did:syr:');
	}

	const identity = await identityRepository.findByDid(did);
	if (!identity) {
		throw error(404, 'Identity not found');
	}

	// Resolve the CURRENT root key from the verified rotation chain (the
	// genesis key when never rotated) rather than echoing identity.public_key,
	// so current_root can never drift from the chain verifiers replay. Encoded
	// as multibase(multicodec-prefix || raw key) to match the stored key format.
	const { publicKey, chain } = await getCurrentRootKey(did);
	const currentRoot = encodeMultibase(new Uint8Array([...ED25519_MULTICODEC_PREFIX, ...publicKey]));

	return json(
		{
			did,
			current_root: currentRoot,
			rotations: chain
		},
		{
			headers: {
				'Cache-Control': 'public, max-age=300'
			}
		}
	);
};
