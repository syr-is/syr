import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canonicalize } from '@syr-is/crypto';
import {
	IndependentLoginChallengeRequestSchema,
	type IndependentLoginChallengeMessage
} from '@syr-is/types';
import { config, independentLogin, allowedOrigins, isAllowedOrigin } from '$lib/config';
import { setChallenge } from '$lib/server/independent-login-store';

/**
 * POST /api/auth/independent-login/challenge
 *
 * Creates a challenge for Syner/external key login.
 * Returns challenge_id, message to sign, and deeplink URL.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const data = IndependentLoginChallengeRequestSchema.parse(body);

		const originStr = new URL(data.origin).origin;
		if (!isAllowedOrigin(originStr, allowedOrigins)) {
			return json(
				{ error: 'invalid_origin', error_description: 'Origin does not match instance' },
				{ status: 403 }
			);
		}

		const publicUrl = new URL(config.PUBLIC_URL);
		const challengeId = crypto.randomUUID();
		const now = new Date();
		const expiresAt = new Date(now.getTime() + independentLogin.challengeTtl * 1000);

		const messageObj: IndependentLoginChallengeMessage = {
			domain: publicUrl.hostname,
			nonce: challengeId,
			action: 'login',
			issued_at: now.toISOString(),
			expires_at: expiresAt.toISOString()
		};
		const message = canonicalize(messageObj);

		await setChallenge(challengeId, {
			nonce: challengeId,
			message,
			domain: publicUrl.hostname,
			created_at: now.getTime()
		});

		const callbackBase = `${config.PUBLIC_URL}/auth/independent-callback`;
		const deeplinkUrl = `syr://login?challenge=${encodeURIComponent(challengeId)}&instance=${encodeURIComponent(config.PUBLIC_URL)}&callback=${encodeURIComponent(callbackBase)}`;

		return json({
			challenge_id: challengeId,
			message,
			deeplink_url: deeplinkUrl,
			expires_in: independentLogin.challengeTtl
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'name' in err && (err as Error).name === 'ZodError') {
			return json(
				{ error: 'invalid_request', error_description: 'Invalid challenge request' },
				{ status: 400 }
			);
		}
		console.error('Independent login challenge error:', err);
		return json(
			{ error: 'server_error', error_description: 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
