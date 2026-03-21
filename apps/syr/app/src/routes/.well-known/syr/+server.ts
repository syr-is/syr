import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/config';

/**
 * Instance discovery stub (Phase 0 roadmap). Extend with version matrix and links as the protocol matures.
 */
export const GET: RequestHandler = async () => {
	const base = config.PUBLIC_URL.replace(/\/$/, '');
	return json({
		name: 'syr',
		public_url: base,
		api: {
			public_profile: `${base}/api/public/profile`,
			public_posts: `${base}/api/public/posts`
		}
	});
};
