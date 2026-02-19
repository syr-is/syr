import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityController } from '$lib/controllers/identity.controller';
import { buildAegisBundleFromIdentity } from '$lib/utils/aegis-bundle.server';

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

	const identity = await identityController.getIdentity(locals.user.id);
	if (!identity) {
		throw error(404, {
			code: 'NO_IDENTITY',
			message: 'User has no identity'
		});
	}

	const aegisBundle = buildAegisBundleFromIdentity(identity);
	if (!aegisBundle) {
		throw error(404, {
			code: 'NO_AEGIS',
			message: 'Identity has no Aegis bundle'
		});
	}

	return json({
		status: 'success',
		data: { aegisBundle },
		meta: { timestamp: new Date().toISOString() }
	});
};
