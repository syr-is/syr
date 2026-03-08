import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { userRepository } from '$lib/repositories/user.repository';

/**
 * GET /api/instance-admins
 *
 * Returns usernames and DIDs of instance administrators.
 * Used by delete-account dialog when user has no identity (lost keys).
 * Requires auth.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	const admins = await userRepository.findAdmins();
	return json({ admins });
};
