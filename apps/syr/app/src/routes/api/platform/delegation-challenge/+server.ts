import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canonicalize } from '@syr-is/crypto';
import { config, platformDelegation } from '$lib/config';
import { setChallenge, setDelegationMeta } from '$lib/server/independent-login-store';

/**
 * POST /api/platform/delegation-challenge
 *
 * Creates a signing challenge for delegation. Stores it in the
 * independent login challenge KV so Syner's standard verify flow finds it.
 * Also stores delegation metadata so the verify endpoint can complete
 * the platform delegation after signature verification.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'unauthorized' }, { status: 401 });
	}

	try {
		const body = await request.json();
		const { delegation_statement, delegation_id } = body;

		if (!delegation_statement || !delegation_id) {
			return json(
				{
					error: 'invalid_request',
					error_description: 'delegation_statement and delegation_id are required'
				},
				{ status: 400 }
			);
		}

		const message =
			typeof delegation_statement === 'string'
				? delegation_statement
				: canonicalize(delegation_statement);

		const challengeId = crypto.randomUUID();
		const publicUrl = new URL(config.PUBLIC_URL);

		// Store as a standard independent login challenge so Syner's verify finds it
		await setChallenge(challengeId, {
			nonce: challengeId,
			message,
			domain: publicUrl.hostname,
			created_at: Date.now()
		});

		// Store delegation metadata separately — consumed by verify after sig check
		await setDelegationMeta(challengeId, {
			delegation_id,
			user_id: locals.user.id.toString()
		});

		// Standard Syner deeplink — posts to /api/auth/independent-login/verify
		const callbackBase = `${config.PUBLIC_URL}/auth/independent-callback`;
		const deeplinkUrl = `syr://login?challenge=${encodeURIComponent(challengeId)}&instance=${encodeURIComponent(config.PUBLIC_URL)}&callback=${encodeURIComponent(callbackBase)}`;

		return json({
			challenge_id: challengeId,
			message,
			deeplink_url: deeplinkUrl,
			expires_in: platformDelegation.registrationExpiresIn
		});
	} catch (err) {
		console.error('Delegation challenge error:', err);
		return json(
			{ error: 'server_error', error_description: 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
