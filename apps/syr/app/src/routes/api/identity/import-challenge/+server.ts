import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { DidSyrSchema } from '@syr-is/types';
import { canonicalize } from '@syr-is/crypto';
import { config, independentLogin } from '$lib/config';
import { setImportChallenge } from '$lib/server/export-verify-store';

const ImportChallengeRequestSchema = z.object({
	did: DidSyrSchema
});

/**
 * POST /api/identity/import-challenge
 *
 * Creates a challenge for identity import verification (user signs to prove key control of bundle DID).
 * Requires auth. Body: { did } from the bundle's identity.json.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch (e) {
		if (e instanceof SyntaxError) {
			throw error(400, {
				code: 'INVALID_REQUEST',
				message: 'Invalid JSON body'
			});
		}
		throw e;
	}
	let did: string;
	try {
		({ did } = ImportChallengeRequestSchema.parse(body));
	} catch (e) {
		if (e instanceof z.ZodError) {
			throw error(400, {
				code: 'INVALID_REQUEST',
				message: 'Invalid request: did must be a valid did:syr DID'
			});
		}
		throw error(500, { code: 'INTERNAL_ERROR', message: 'Unexpected error' });
	}

	const challengeId = crypto.randomUUID();
	const now = new Date();
	const expiresAt = new Date(now.getTime() + independentLogin.challengeTtl * 1000);

	const messageObj = {
		domain: new URL(config.PUBLIC_URL).hostname,
		nonce: challengeId,
		action: 'import',
		issued_at: now.toISOString(),
		expires_at: expiresAt.toISOString()
	};
	const message = canonicalize(messageObj);

	await setImportChallenge(challengeId, {
		message,
		domain: messageObj.domain,
		expected_did: did,
		user_id: locals.user.id
	});

	const deeplinkUrl = `syr://import?challenge=${encodeURIComponent(challengeId)}&instance=${encodeURIComponent(config.PUBLIC_URL)}&did=${encodeURIComponent(did)}`;

	return json({
		challenge_id: challengeId,
		message,
		deeplink_url: deeplinkUrl,
		expires_in: independentLogin.challengeTtl
	});
};
