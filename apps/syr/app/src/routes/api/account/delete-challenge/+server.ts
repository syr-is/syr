import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { canonicalize } from '@syr-is/crypto';
import { config, independentLogin } from '$lib/config';
import { identityController } from '$lib/controllers/identity.controller';
import { userRepository } from '$lib/repositories/user.repository';
import { buildAegisBundleFromIdentity } from '$lib/utils/aegis-bundle.server';
import { seedHandler } from '$lib/services/seed-handler';
import { verifyPassword } from '$lib/server/auth';
import { setDeleteAccountChallenge, setDeleteAccountToken } from '$lib/server/export-verify-store';

const DeleteChallengeBodySchema = z.object({
	password: z.string().optional()
});

/**
 * POST /api/account/delete-challenge
 *
 * Creates a challenge for account deletion verification.
 * - Aegis users: pass { password } to sign server-side and get token immediately
 * - Syner-only users: returns challenge_id for Syner to sign
 * - Users with no identity: pass { password } for password-only verification
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

	const identity = await identityController.getIdentity(locals.user.id);
	const aegisBundle = identity ? buildAegisBundleFromIdentity(identity) : null;

	// Aegis path: password provided → verify decryption (proves key control), return token
	if (aegisBundle && password) {
		try {
			await seedHandler.verify({ bundle: aegisBundle, password });
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

	// Users with no identity: password-only verification
	if (!identity && password) {
		const user = await userRepository.findById(locals.user.id);
		if (!user) {
			throw error(404, { code: 'USER_NOT_FOUND', message: 'User not found' });
		}
		const isValid = await verifyPassword(user.password_hash, password);
		if (!isValid) {
			throw error(403, {
				code: 'INVALID_PASSWORD',
				message: 'Invalid password'
			});
		}
		const deleteAccountToken = crypto.randomUUID();
		await setDeleteAccountToken(deleteAccountToken, { user_id: locals.user.id });
		return json({ delete_account_token: deleteAccountToken });
	}

	// Syner path: user has identity (with or without Aegis) but no password → create challenge
	if (identity) {
		const challengeId = crypto.randomUUID();
		const now = new Date();
		const expiresAt = new Date(now.getTime() + independentLogin.challengeTtl * 1000);

		const messageObj = {
			domain: new URL(config.PUBLIC_URL).hostname,
			nonce: challengeId,
			action: 'delete_account',
			issued_at: now.toISOString(),
			expires_at: expiresAt.toISOString()
		};
		const message = canonicalize(messageObj);

		await setDeleteAccountChallenge(challengeId, {
			message,
			domain: messageObj.domain,
			expected_did: identity.did,
			user_id: locals.user.id
		});

		const deeplinkUrl = `syr://export?challenge=${encodeURIComponent(challengeId)}&instance=${encodeURIComponent(config.PUBLIC_URL)}&did=${encodeURIComponent(identity.did)}`;

		return json({
			challenge_id: challengeId,
			message,
			deeplink_url: deeplinkUrl,
			expires_in: independentLogin.challengeTtl
		});
	}

	// No identity and no password
	throw error(400, {
		code: 'PASSWORD_REQUIRED',
		message: 'Provide password to verify account ownership'
	});
};
