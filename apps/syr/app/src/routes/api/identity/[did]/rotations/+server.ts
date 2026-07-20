import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityRepository } from '$lib/repositories/identity.repository';
import { getRotationChain } from '$lib/server/root-key.server';

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

	const rotations = await getRotationChain(did);

	return json(
		{
			did,
			current_root: identity.public_key,
			rotations
		},
		{
			headers: {
				'Cache-Control': 'public, max-age=300'
			}
		}
	);
};
