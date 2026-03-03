import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canonicalize } from '@syr-is/crypto';
import { config, independentLogin } from '$lib/config';
import { identityController } from '$lib/controllers/identity.controller';
import { setExportChallenge } from '$lib/server/export-verify-store';

/**
 * POST /api/identity/export-challenge
 *
 * Creates a challenge for identity export verification (Syner signs to prove key control).
 * Requires auth. Returns challenge_id, message, deeplink for syr://export.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	const identity = await identityController.getIdentity(locals.user.id);
	if (!identity) {
		throw error(404, { code: 'NO_IDENTITY', message: 'User has no identity' });
	}

	const challengeId = crypto.randomUUID();
	const now = new Date();
	const expiresAt = new Date(now.getTime() + independentLogin.challengeTtl * 1000);

	const messageObj = {
		domain: new URL(config.PUBLIC_URL).hostname,
		nonce: challengeId,
		action: 'export',
		issued_at: now.toISOString(),
		expires_at: expiresAt.toISOString()
	};
	const message = canonicalize(messageObj);

	await setExportChallenge(challengeId, {
		message,
		domain: messageObj.domain,
		expected_did: identity.did
	});

	const deeplinkUrl = `syr://export?challenge=${encodeURIComponent(challengeId)}&instance=${encodeURIComponent(config.PUBLIC_URL)}&did=${encodeURIComponent(identity.did)}`;

	return json({
		challenge_id: challengeId,
		message,
		deeplink_url: deeplinkUrl,
		expires_in: independentLogin.challengeTtl
	});
};
