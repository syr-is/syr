import { json, error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityRepository } from '$lib/repositories/identity.repository';
import { config } from '$lib/config';
import type { SyrIdentityManifest } from '@syr-is/types';

/**
 * GET /.well-known/syr/[did]
 *
 * Per-identity manifest endpoint with content negotiation:
 *   Accept: application/json → manifest JSON (API clients)
 *   Accept: text/html (or default) → 302 redirect to web_profile (browsers)
 */
export const GET: RequestHandler = async ({ params, request }) => {
	const { did } = params;

	if (!did || !did.startsWith('did:syr:')) {
		throw error(400, 'Invalid DID format. Must start with did:syr:');
	}

	const identity = await identityRepository.findByDid(did);
	if (!identity) {
		throw error(404, 'Identity not found');
	}

	const base = config.PUBLIC_URL.replace(/\/$/, '');
	const encoded = encodeURIComponent(did);

	const manifest: SyrIdentityManifest = {
		version: 1,
		did,
		provider: base,
		endpoints: {
			profile: `${base}/api/public/profile/${encoded}`,
			posts: `${base}/api/public/posts/${encoded}`,
			stories: `${base}/api/public/stories/${encoded}`,
			uploads: `${base}/api/public/uploads/${encoded}`,
			did_document: `${base}/api/identity/${encoded}/document`
		},
		web_profile: `${base}/u/${encoded}`
	};

	const accept = request.headers.get('accept') ?? '';
	if (accept.includes('application/json')) {
		return json(manifest, {
			headers: {
				'Cache-Control': 'public, max-age=300'
			}
		});
	}

	redirect(302, manifest.web_profile);
};
