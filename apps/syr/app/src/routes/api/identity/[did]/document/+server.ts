import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityRepository } from '$lib/repositories/identity.repository';
import { buildDidDocument } from '@syr-is/did';
import { config } from '$lib/config';

/**
 * GET /api/identity/[did]/document
 *
 * Returns a DID Document for the given did:syr identifier.
 * Public endpoint — no authentication required.
 * Used by resolvers to discover verification methods and service endpoints.
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

	const document = buildDidDocument({
		did: identity.did,
		publicKeyMultibase: identity.public_key,
		serviceEndpoint: config.PUBLIC_URL
	});

	return json(document, {
		headers: {
			'Content-Type': 'application/did+ld+json',
			'Cache-Control': 'public, max-age=300'
		}
	});
};
