import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityController } from '$lib/controllers/identity.controller';

/**
 * POST /api/identity/export-keys
 *
 * Export the private key for the current user's identity.
 * Only works if the identity was created with server-managed keys.
 * This is a sensitive operation and should be audit logged (TODO).
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}

	try {
		const keys = await identityController.exportKeys(locals.user.id);
		return json({ data: keys });
	} catch (err) {
		if (err instanceof Error) {
			if (err.message === 'User has no identity.') {
				throw error(404, { code: 'NOT_FOUND', message: err.message });
			}
			if (err.message.includes('not created with server-managed keys')) {
				throw error(400, { code: 'BAD_REQUEST', message: err.message });
			}
		}
		console.error('Key export error:', err);
		throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to export keys' });
	}
};
