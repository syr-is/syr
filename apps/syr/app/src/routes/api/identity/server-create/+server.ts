import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityController } from '$lib/controllers/identity.controller';

/**
 * POST /api/identity/server-create
 *
 * Creates an identity server-side for the authenticated user.
 * The server generates the root keypair, derives the DID,
 * and stores the encrypted private key.
 *
 * Used by the layout to auto-provision identity on first login.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'Authentication required'
		});
	}

	try {
		const result = await identityController.createIdentityServerSide(locals.user.id);
		return json({
			status: 'success',
			data: result
		});
	} catch (err) {
		if (err instanceof Error && err.message === 'User already has an identity.') {
			throw error(409, {
				code: 'IDENTITY_EXISTS',
				message: err.message
			});
		}
		console.error('[identity.server-create] Error:', err);
		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: err instanceof Error ? err.message : 'Failed to create identity'
		});
	}
};
