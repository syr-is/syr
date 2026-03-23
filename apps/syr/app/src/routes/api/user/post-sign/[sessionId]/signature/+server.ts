import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { completePostSignSession, getPostSignSession } from '$lib/server/export-verify-store';
import { identityController } from '$lib/controllers/identity.controller';
import { SignedMutationEnvelopeSchema } from '@syr-is/types';
import { initCryptoWasm, canonicalize } from '@syr-is/crypto';

/**
 * PUT /api/user/post-sign/[sessionId]/signature
 * Syner uploads signature + device public key (no cookie).
 */
export const PUT: RequestHandler = async ({ request, params }) => {
	const sessionId = params.sessionId?.trim();
	if (!sessionId) {
		throw error(400, { code: 'BAD_REQUEST', message: 'Missing session' });
	}

	const session = await getPostSignSession(sessionId);
	if (!session || session.status !== 'pending') {
		throw error(404, {
			code: 'NOT_FOUND',
			message: 'Session not found, expired, or already completed'
		});
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid JSON' });
	}

	const envParsed = SignedMutationEnvelopeSchema.safeParse(body);
	if (!envParsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Invalid signed mutation envelope',
			details: envParsed.error.flatten()
		});
	}
	const envelope = envParsed.data;

	if (envelope.device_public_key !== session.requested_device_public_key) {
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'device_public_key does not match this signing session.'
		});
	}

	const identity = await identityController.getIdentity(session.user_id);
	if (!identity) {
		throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Identity missing for session' });
	}

	try {
		await initCryptoWasm();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw error(500, {
			code: 'WASM_INIT_FAILED',
			message: `Failed to initialize crypto WASM: ${msg}`
		});
	}
	const sessionCanon = canonicalize(session.payload);
	const envelopeCanon = canonicalize(envelope.payload as Record<string, unknown>);
	if (sessionCanon !== envelopeCanon) {
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'Signed payload does not match the session payload.'
		});
	}

	try {
		await identityController.verifyClientSignedContent(
			identity,
			session.payload,
			envelope.signature,
			envelope.device_public_key
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Invalid signature';
		throw error(400, { code: 'INVALID_SIGNATURE', message: msg });
	}

	const ok = await completePostSignSession(sessionId, {
		payload: session.payload,
		signature: envelope.signature,
		device_public_key: envelope.device_public_key
	});
	if (!ok) {
		throw error(409, { code: 'CONFLICT', message: 'Could not complete signing session' });
	}

	return json({
		status: 'success',
		data: { ok: true },
		meta: { timestamp: new Date().toISOString() }
	});
};
