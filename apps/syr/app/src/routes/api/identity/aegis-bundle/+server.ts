import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getIdentityContext } from '$lib/server/identity-context';

/**
 * GET /api/identity/aegis-bundle
 *
 * Returns the Aegis bundle for the authenticated user's identity.
 * Used when the client needs to re-unlock (e.g. after page refresh) -
 * fetch bundle, prompt for password, decrypt and store seed.
 *
 * Requires: Authenticated session with an identity that has Aegis.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'Authentication required'
		});
	}

	const ctx = await getIdentityContext(locals.user.id, locals);
	if (!ctx.identity) {
		throw error(404, {
			code: 'NO_IDENTITY',
			message: 'User has no identity'
		});
	}

	if (!ctx.aegisBundle) {
		throw error(404, {
			code: 'NO_AEGIS',
			message: 'Identity has no Aegis bundle'
		});
	}

	return json({
		status: 'success',
		data: { aegisBundle: ctx.aegisBundle },
		meta: { timestamp: new Date().toISOString() }
	});
};
