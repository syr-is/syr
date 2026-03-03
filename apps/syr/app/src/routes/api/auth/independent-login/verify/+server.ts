import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { IndependentLoginVerifyRequestSchema } from '@syr-is/types';
import { independentLoginController } from '$lib/controllers/independent-login.controller';
import { profileRepository } from '$lib/repositories/profile.repository';
import {
	getChallenge,
	deleteChallenge,
	setCallbackToken
} from '$lib/server/independent-login-store';
import { notifyVerified } from '$lib/server/independent-login-broadcast';
import { generateSyncToken } from '$lib/server/auth';

/** Profile needs onboarding when display_name is auto-generated (il_xxx pattern). */
function needsOnboarding(displayName: string | null | undefined): boolean {
	return !!displayName && /^il_[a-zA-Z0-9_-]+_\w{6}$/.test(displayName);
}

/**
 * POST /api/auth/independent-login/verify
 *
 * Verifies the signature, creates/finds user, creates session.
 * Returns one-time callback token for redirect.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	try {
		const body = await request.json();
		const data = IndependentLoginVerifyRequestSchema.parse(body);

		const challenge = await getChallenge(data.challenge_id);
		if (!challenge) {
			return json(
				{ error: 'challenge_expired', error_description: 'Challenge not found or expired' },
				{ status: 410 }
			);
		}

		// Consume challenge immediately to prevent replay. If verify fails, user must fetch new challenge.
		await deleteChallenge(data.challenge_id);

		// Future: if invite_code_required && !valid invite -> return invite_required
		const user = await independentLoginController.verifyAndGetUser(
			data.challenge_id,
			data.did,
			challenge.message,
			data.signature,
			data.invite_code,
			data.profile
		);

		const ip = getClientAddress?.() || request.headers.get('x-forwarded-for') || undefined;
		const userAgent = request.headers.get('user-agent') || undefined;
		const jwt = await independentLoginController.createSessionForUser(user, { ip, userAgent });

		const callbackToken = crypto.randomUUID();
		await setCallbackToken(callbackToken, jwt);

		// Notify SSE clients (login page with QR) so they complete login instead of opening on phone
		notifyVerified(data.challenge_id, callbackToken);

		const response: {
			success: true;
			callback_token: string;
			sync_token?: string;
		} = {
			success: true as const,
			callback_token: callbackToken
		};

		const profile = await profileRepository.findByUserId(user.id);
		if (profile && needsOnboarding(profile.display_name)) {
			response.sync_token = generateSyncToken(user.id.toString());
		}

		return json(response);
	} catch (err) {
		if (err && typeof err === 'object' && 'name' in err && (err as Error).name === 'ZodError') {
			return json(
				{ error: 'invalid_request', error_description: 'Invalid verify request' },
				{ status: 400 }
			);
		}
		if (err instanceof Error) {
			if (err.message === 'Invalid signature') {
				return json(
					{ error: 'invalid_signature', error_description: 'Signature verification failed' },
					{ status: 403 }
				);
			}
			if (err.message === 'User not found') {
				return json(
					{ error: 'server_error', error_description: 'User not found' },
					{ status: 500 }
				);
			}
		}
		console.error('Independent login verify error:', err);
		return json(
			{ error: 'server_error', error_description: 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
