import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createPostSignSession } from '$lib/server/export-verify-store';
import { config } from '$lib/config';
import { PostSignedPayloadV1Schema } from '@syr-is/types';
import { getIdentityContext } from '$lib/server/identity-context';
import { delegatedKeyRepository } from '$lib/repositories/identity.repository';

/**
 * POST /api/user/post-sign-session
 * Start Syner-assisted signing for a post@v1 payload.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	const did = locals.user.did?.trim();
	if (!did || !did.startsWith('did:syr:')) {
		throw error(400, {
			code: 'BAD_REQUEST',
			message: 'Your account needs a DID before signing posts with Syner.'
		});
	}

	const ctx = await getIdentityContext(locals.user.id, locals);
	const rootPk = ctx.identity?.public_key?.trim();
	if (!rootPk) {
		throw error(400, {
			code: 'NO_IDENTITY',
			message: 'No identity public key on record.'
		});
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid JSON' });
	}
	if (body == null || typeof body !== 'object') {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Expected JSON object' });
	}
	const rawPayload = (body as Record<string, unknown>).payload;
	const requestedRaw = (body as Record<string, unknown>).requested_device_public_key;

	const parsed = PostSignedPayloadV1Schema.safeParse(rawPayload);
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Invalid post@v1 payload',
			details: parsed.error.flatten()
		});
	}
	if (parsed.data.did !== did) {
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'Signed payload DID does not match your account.'
		});
	}

	const requested =
		typeof requestedRaw === 'string' && requestedRaw.trim() !== '' ? requestedRaw.trim() : rootPk;

	if (requested !== rootPk) {
		const active = await delegatedKeyRepository.findActiveByDid(did);
		const ok = active.some((dk) => dk.public_key === requested);
		if (!ok) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'requested_device_public_key is not your root key or an active delegated device.'
			});
		}
	}

	const payload = structuredClone(parsed.data) as Record<string, unknown>;

	const sessionId = await createPostSignSession({
		user_id: locals.user.id,
		expected_did: did,
		requested_device_public_key: requested,
		payload
	});

	const origin = config.PUBLIC_URL.replace(/\/$/, '');
	const deeplinkUrl =
		`syr://post-sign?origin=${encodeURIComponent(origin)}` +
		`&session=${encodeURIComponent(sessionId)}` +
		`&did=${encodeURIComponent(did)}`;

	return json({
		status: 'success',
		data: {
			session_id: sessionId,
			deeplink_url: deeplinkUrl,
			expires_in_sec: 300,
			requested_device_public_key: requested
		},
		meta: { timestamp: new Date().toISOString() }
	});
};
