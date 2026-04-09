import { json, error } from '@sveltejs/kit';
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
			did_document: `${base}/api/identity/${encoded}/document`,
			public_following: `${base}/api/public/following/${encoded}`,
			public_emojis: `${base}/api/public/emojis/${encoded}`,
			public_gifs: `${base}/api/public/gifs/${encoded}`,
			public_comments: `${base}/api/public/comments/${encoded}`,
			public_reactions: `${base}/api/public/reactions/${encoded}`
		},
		web_profile: `${base}/u/${encoded}`
	};

	const accept = request.headers.get('accept') ?? '';
	if (accept.includes('application/json')) {
		return json(manifest, {
			headers: {
				'Cache-Control': 'public, max-age=300',
				Vary: 'Accept'
			}
		});
	}

	return new Response(null, {
		status: 302,
		headers: {
			Location: manifest.web_profile,
			Vary: 'Accept'
		}
	});
};
