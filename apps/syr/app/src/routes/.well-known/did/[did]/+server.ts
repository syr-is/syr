import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityRepository } from '$lib/repositories/identity.repository';
import { buildDidDocument } from '@syr-is/did';
import { config } from '$lib/config';

/**
 * GET /.well-known/did/[did]
 *
 * Well-known path alias for DID Document resolution.
 * Returns the same DID Document as /api/identity/[did]/document.
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
