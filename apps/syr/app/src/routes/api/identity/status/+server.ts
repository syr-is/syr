import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityController } from '$lib/controllers/identity.controller';

/**
 * GET /api/identity/status
 *
 * Check if the authenticated user has an identity.
 * Used by the client to determine whether to trigger identity creation flow.
 *
 * Requires: Authenticated session
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'Authentication required'
		});
	}

	const identity = await identityController.getIdentity(locals.user.id);

	return json({
		status: 'success',
		data: {
			hasIdentity: identity !== null,
			did: identity?.did ?? null
		}
	});
};
