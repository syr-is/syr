import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateSyncToken } from '$lib/server/auth';

/**
 * GET /api/auth/independent-login/sync-token
 *
 * Returns a short-lived sync token for profile sync.
 * Requires an authenticated session (cookie).
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'UNAUTHORIZED',
			message: 'You must be logged in to get a sync token'
		});
	}

	const syncToken = generateSyncToken(locals.user.id);
	return json({ sync_token: syncToken });
};
