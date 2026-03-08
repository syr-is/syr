import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { canonicalize } from '@syr-is/crypto';
import { config, independentLogin } from '$lib/config';
import { getIdentityContext } from '$lib/server/identity-context';
import { seedHandler } from '$lib/services/seed-handler';
import { setDeleteAccountChallenge, setDeleteAccountToken } from '$lib/server/export-verify-store';

const DeleteChallengeBodySchema = z.object({
	password: z.string().optional()
});

/**
 * POST /api/account/delete-challenge
 *
 * Creates a challenge for account deletion verification.
 * - Aegis users: pass { password } to verify key control, get token immediately
 * - Syner-only users: returns challenge_id for Syner to sign
 * - Users with no identity: deletion not supported; direct to contact instance administrators
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		body = {};
	}
	const parsed = DeleteChallengeBodySchema.safeParse(body);
	const password = parsed.success ? parsed.data.password : undefined;

	const ctx = await getIdentityContext(locals.user.id, locals);

	// Aegis path: password provided → verify decryption (proves key control), return token
	if (ctx.aegisBundle && password) {
		try {
			await seedHandler.verify({ bundle: ctx.aegisBundle, password });
			const deleteAccountToken = crypto.randomUUID();
			await setDeleteAccountToken(deleteAccountToken, { user_id: locals.user.id });
			return json({
				delete_account_token: deleteAccountToken
			});
		} catch (_e) {
			throw error(403, {
				code: 'INVALID_PASSWORD',
				message: 'Invalid password — could not decrypt Aegis'
			});
		}
	}

	// Syner path: user has identity (with or without Aegis) → create challenge
	if (ctx.identity) {
		const challengeId = crypto.randomUUID();
		const now = new Date();
		const expiresAt = new Date(now.getTime() + independentLogin.challengeTtl * 1000);

		const messageObj = {
			domain: new URL(config.PUBLIC_URL).host,
			nonce: challengeId,
			action: 'delete_account',
			issued_at: now.toISOString(),
			expires_at: expiresAt.toISOString()
		};
		const message = canonicalize(messageObj);

		await setDeleteAccountChallenge(challengeId, {
			message,
			domain: messageObj.domain,
			expected_did: ctx.identity.did,
			user_id: locals.user.id
		});

		const deeplinkUrl = `syr://delete-account?challenge=${encodeURIComponent(challengeId)}&instance=${encodeURIComponent(config.PUBLIC_URL)}&did=${encodeURIComponent(ctx.identity.did)}`;

		return json({
			challenge_id: challengeId,
			message,
			deeplink_url: deeplinkUrl,
			expires_in: independentLogin.challengeTtl
		});
	}

	// No identity: deletion requires signing; direct user to contact admins
	throw error(400, {
		code: 'LOST_IDENTITY',
		message:
			'Deletion requires signing with your identity keys. Lost your keys? Contact instance administrators for assistance.'
	});
};
