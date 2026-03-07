import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { DidSyrSchema } from '@syr-is/types';
import { canonicalize } from '@syr-is/crypto';
import { config, independentLogin } from '$lib/config';
import { setPublicImportChallenge } from '$lib/server/export-verify-store';

const ImportChallengePublicRequestSchema = z.object({
	did: DidSyrSchema
});

/**
 * POST /api/identity/import-challenge-public
 *
 * Creates a challenge for identity import verification when user is NOT logged in (migration flow).
 * No auth required. Body: { did } from the bundle's identity.json.
 * When Syner verifies, a public import token (did-only) is issued for register-with-import.
 */
export const POST: RequestHandler = async ({ request }) => {
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
		({ did } = ImportChallengePublicRequestSchema.parse(body));
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

	await setPublicImportChallenge(challengeId, {
		message,
		domain: messageObj.domain,
		expected_did: did
	});

	const deeplinkUrl = `syr://import?challenge=${encodeURIComponent(challengeId)}&instance=${encodeURIComponent(config.PUBLIC_URL)}&did=${encodeURIComponent(did)}`;

	return json({
		challenge_id: challengeId,
		message,
		deeplink_url: deeplinkUrl,
		expires_in: independentLogin.challengeTtl
	});
};
