import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { IdentityAuthTokenRequestSchema } from '@syr-is/types';
import { identityAuth } from '$lib/config';
import { generateAccessToken } from '$lib/server/auth';
import { pendingChallenges } from '$lib/server/identity-auth-store';

/**
 * POST /api/auth/identity-login/token
 *
 * Token exchange endpoint. After the user consents, the third-party
 * exchanges the authorization code for an access token.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const data = IdentityAuthTokenRequestSchema.parse(body);

		// Find the challenge that issued this code
		let matchedChallengeId: string | null = null;
		let matchedChallenge:
			| (typeof pendingChallenges extends Map<string, infer V> ? V : never)
			| null = null;

		for (const [id, challenge] of pendingChallenges) {
			if (challenge.code === data.code) {
				matchedChallengeId = id;
				matchedChallenge = challenge;
				break;
			}
		}

		if (!matchedChallengeId || !matchedChallenge) {
			return json(
				{
					error: 'invalid_code',
					error_description: 'Authorization code not found or already used'
				},
				{ status: 400 }
			);
		}

		// Verify origin matches
		if (matchedChallenge.origin !== data.origin) {
			return json(
				{
					error: 'invalid_origin',
					error_description: 'Origin does not match the original challenge'
				},
				{ status: 403 }
			);
		}

		// Verify callback_url matches
		if (matchedChallenge.callback_url !== data.callback_url) {
			return json(
				{
					error: 'invalid_request',
					error_description: 'Callback URL does not match the original challenge'
				},
				{ status: 400 }
			);
		}

		// Check if challenge has expired
		const now = Date.now();
		const expiryMs = identityAuth.challengeExpiresIn * 1000;
		if (now - matchedChallenge.created_at > expiryMs) {
			pendingChallenges.delete(matchedChallengeId);
			return json(
				{
					error: 'challenge_expired',
					error_description: 'The authorization challenge has expired'
				},
				{ status: 410 }
			);
		}

		// Generate an access token for the third party
		const accessToken = generateAccessToken(
			{
				userId: matchedChallenge.user_id,
				sessionId: `identity-auth:${matchedChallengeId}`
			},
			`${identityAuth.tokenExpiresIn}s`
		);

		// Clean up the used challenge
		pendingChallenges.delete(matchedChallengeId);

		return json({
			access_token: accessToken,
			token_type: 'Bearer' as const,
			expires_in: identityAuth.tokenExpiresIn,
			did: matchedChallenge.did,
			scopes: matchedChallenge.scopes
		});
	} catch (err) {
		if (err instanceof Error && err.name === 'ZodError') {
			return json(
				{ error: 'invalid_request', error_description: 'Invalid token request' },
				{ status: 400 }
			);
		}
		console.error('Identity auth token exchange error:', err);
		return json(
			{ error: 'server_error', error_description: 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
