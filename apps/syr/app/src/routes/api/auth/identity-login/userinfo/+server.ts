import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityRepository } from '$lib/repositories/identity.repository';
import { profileRepository } from '$lib/repositories/profile.repository';

/**
 * GET /api/auth/identity-login/userinfo
 *
 * Returns user info for a valid identity-auth access token.
 * Third parties call this after obtaining an access token via the token exchange.
 */
export const GET: RequestHandler = async ({ locals }) => {
	// The access token should be validated via the standard auth middleware
	if (!locals.user) {
		throw error(401, {
			code: 'UNAUTHORIZED',
			message: 'Valid access token required'
		});
	}

	// Get the user's identity
	const identity = await identityRepository.findByUserId(locals.user.id);

	// Get the user's profile
	const profile = await profileRepository.findByUserId(locals.user.id);

	return json({
		did: identity?.did ?? null,
		username: locals.user.username,
		display_name: profile?.display_name ?? undefined,
		bio: profile?.bio ?? undefined,
		avatar_url: profile?.avatar_url ?? undefined,
		banner_url: profile?.banner_url ?? undefined,
		public_key: identity?.public_key ?? undefined
	});
};
