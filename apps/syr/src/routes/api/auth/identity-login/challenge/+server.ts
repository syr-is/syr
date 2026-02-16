import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityRepository } from '$lib/repositories/identity.repository';
import { userRepository } from '$lib/repositories/user.repository';
import { IdentityAuthChallengeRequestSchema } from '@syr-is/types';
import { identityAuth, config } from '$lib/config';
import { pendingChallenges, cleanupExpiredChallenges } from '$lib/server/identity-auth-store';

/**
 * POST /api/auth/identity-login/challenge
 *
 * A third-party platform calls this endpoint to initiate identity-based login.
 * The SYR instance looks up the DID, verifies it belongs to a local user,
 * and returns a challenge with a consent URL.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const data = IdentityAuthChallengeRequestSchema.parse(body);

		// Resolve the DID to a local identity
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

		// Generate challenge ID
		const challengeId = crypto.randomUUID();

		// Store the pending challenge
		pendingChallenges.set(challengeId, {
			did: data.did,
			origin: data.origin,
			scopes: data.scopes,
			callback_url: data.callback_url,
			state: data.state,
			user_id: user.id.toString(),
			created_at: Date.now()
		});

		// Clean up expired challenges periodically
		cleanupExpiredChallenges();

		const consentUrl = `${config.PUBLIC_URL}/auth/consent?challenge=${challengeId}`;

		return json({
			challenge_id: challengeId,
			consent_url: consentUrl,
			expires_in: identityAuth.challengeExpiresIn
		});
	} catch (err) {
		if (err instanceof Error && err.name === 'ZodError') {
			return json(
				{ error: 'invalid_request', error_description: 'Invalid challenge request' },
				{ status: 400 }
			);
		}
		console.error('Identity auth challenge error:', err);
		return json(
			{ error: 'server_error', error_description: 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
