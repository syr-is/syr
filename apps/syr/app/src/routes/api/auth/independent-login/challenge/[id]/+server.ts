import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { independentLogin } from '$lib/config';
import { getChallenge } from '$lib/server/independent-login-store';

/**
 * GET /api/auth/independent-login/challenge/:id
 *
 * Public endpoint for Syner to fetch challenge details.
 * Returns message, domain, expires_at.
 */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export const GET: RequestHandler = async ({ params }) => {
	const { id } = params;
	const challenge = await getChallenge(id);
	if (!challenge) {
		return json(
			{ error: 'challenge_expired', error_description: 'Challenge not found or expired' },
			{ status: 410, headers: NO_STORE }
		);
	}
	const expiryTs = challenge.created_at + independentLogin.challengeTtl * 1000;
	if (Date.now() > expiryTs) {
		return json(
			{ error: 'challenge_expired', error_description: 'Challenge not found or expired' },
			{ status: 410, headers: NO_STORE }
		);
	}
	const expiresAt = new Date(expiryTs).toISOString();
	return json(
		{
			message: challenge.message,
			domain: challenge.domain,
			expires_at: expiresAt
		},
		{ headers: NO_STORE }
	);
};
