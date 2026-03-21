import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/config';

/**
 * Instance discovery stub (Phase 0 roadmap). Extend with version matrix and links as the protocol matures.
 */
export const GET: RequestHandler = async () => {
	return json({
		name: 'syr',
		public_url: config.PUBLIC_URL,
		api: {
			public_profile: `${config.PUBLIC_URL}/api/public/profile`,
			public_posts: `${config.PUBLIC_URL}/api/public/posts`
		}
	});
};
