import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityRepository } from '$lib/repositories/identity.repository';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { IdentityResolutionRequestSchema } from '@syr-is/types';
import { config } from '$lib/config';

/**
 * POST /api/auth/identity-login/resolve
 *
 * Resolves a did:syr DID to instance information.
 * Third parties use this to discover which SYR instance hosts a given identity.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const data = IdentityResolutionRequestSchema.parse(body);

		// Look up the identity
		const identity = await identityRepository.findByDid(data.did);
		if (!identity) {
			return json(
				{
					error: 'unknown_did',
					error_description: 'No identity found for this DID on this instance'
				},
				{ status: 404 }
			);
		}

		// Get the user
		const user = await userRepository.findById(identity.user_id);
		if (!user) {
			return json(
				{
					error: 'unknown_did',
					error_description: 'User associated with this DID no longer exists'
				},
				{ status: 404 }
			);
		}

		return json({
			did: data.did,
			instance_url: config.PUBLIC_URL,
			public_key: identity.public_key,
			username: user.username
		});
	} catch (err) {
		if (err instanceof Error && err.name === 'ZodError') {
			return json(
				{ error: 'invalid_request', error_description: 'Invalid resolution request' },
				{ status: 400 }
			);
		}
		console.error('Identity resolution error:', err);
		return json(
			{ error: 'server_error', error_description: 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
