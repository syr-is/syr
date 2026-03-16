import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { DidSyrSchema } from '@syr-is/types';
import { canonicalize } from '@syr-is/crypto';
import { config, independentLogin, security } from '$lib/config';
import { kvService } from '$lib/services/kv';
import { setPublicImportChallenge } from '$lib/server/export-verify-store';

const ImportChallengePublicRequestSchema = z.object({
	did: DidSyrSchema
});

const RATE_LIMIT_TYPE = 'rate_limit';
const RATE_LIMIT_INDEX_PREFIX = 'import_challenge_public:';

/**
 * POST /api/identity/import-challenge-public
 *
 * Creates a challenge for identity import verification when user is NOT logged in (migration flow).
 * No auth required. Body: { did } from the bundle's identity.json.
 * When Syner verifies, a public import token (did-only) is issued for register-with-import.
 * Rate-limited by client IP.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
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

	// Rate limit by client IP (atomic to avoid TOCTOU)
	// Sanitize clientId: KV index allows [a-zA-Z0-9_:-] only; IPv4/IPv6 have dots
	const clientId = getClientAddress?.() ?? 'unknown';
	const clientIdSafe = clientId.replace(/\./g, '_');
	const rateLimitIndex = `${RATE_LIMIT_INDEX_PREFIX}${clientIdSafe}`;
	const ttlSeconds = Math.ceil(security.rateLimitWindow / 1000);
	try {
		await kvService.atomicIncrementField(
			RATE_LIMIT_TYPE,
			rateLimitIndex,
			'count',
			1,
			undefined,
			security.rateLimitMax,
			ttlSeconds
		);
	} catch (e) {
		if (e instanceof Error && e.message === 'QUOTA_EXCEEDED') {
			throw error(429, {
				code: 'RATE_LIMIT_EXCEEDED',
				message: 'Too many import challenge requests. Please try again later.'
			});
		}
		const kvId = `kv:${RATE_LIMIT_TYPE}:${rateLimitIndex}`;
		console.error('[import-challenge-public] KV rate-limit error:', {
			clientId,
			rateLimitIndex,
			kvId,
			error: e instanceof Error ? e.message : String(e),
			stack: e instanceof Error ? e.stack : undefined
		});
		throw e;
	}

	const challengeId = crypto.randomUUID();
	const now = new Date();
	const expiresAt = new Date(now.getTime() + independentLogin.challengeTtl * 1000);

	const messageObj = {
		domain: new URL(config.PUBLIC_URL).host,
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
