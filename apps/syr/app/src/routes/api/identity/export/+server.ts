import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityController } from '$lib/controllers/identity.controller';

/**
 * GET /api/identity/export
 *
 * Export the user's identity as a portable bundle.
 * Returns: DID, public key, delegated keys, profile snapshot, timestamp.
 * Never includes private keys.
 *
 * Requires: Authenticated session with an existing identity.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'Authentication required'
		});
	}

	try {
		const bundle = await identityController.exportIdentity(locals.user.id);

		return json({
			status: 'success',
			data: bundle,
			meta: {
				timestamp: new Date().toISOString()
			}
		});
	} catch (err) {
		console.error('Identity export error:', err);

		if (err instanceof Error) {
			if (err.message.includes('no identity') || err.message.includes('no profile')) {
				throw error(404, {
					code: 'NOT_FOUND',
					message: err.message
				});
			}
		}

		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Identity export failed'
		});
	}
};
