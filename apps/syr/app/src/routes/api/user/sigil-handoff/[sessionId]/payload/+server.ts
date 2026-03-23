import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	completeSigilHandoffSession,
	getSigilHandoffSession
} from '$lib/server/export-verify-store';
import { initCryptoWasm, decodePublicKey, deriveDid } from '@syr-is/crypto';

function isValidSigilShape(sigil: unknown): boolean {
	if (sigil == null || typeof sigil !== 'object') return false;
	const o = sigil as Record<string, unknown>;
	return 'v' in o && 'kdf' in o && 'enc' in o && 'pub' in o;
}

function didFromSigilPubField(sigil: Record<string, unknown>): string | null {
	const pub = sigil.pub;
	if (typeof pub !== 'string' || !pub.startsWith('z')) return null;
	try {
		const pk = decodePublicKey(pub);
		return deriveDid(pk);
	} catch {
		return null;
	}
}

/**
 * POST /api/user/sigil-handoff/[sessionId]/payload
 * Syner uploads encrypted Sigil JSON (no JWT). Bound by random session id + short TTL.
 */
export const POST: RequestHandler = async ({ request, params }) => {
	const sessionId = params.sessionId?.trim();
	if (!sessionId) throw error(400, 'Missing session');

	const existing = await getSigilHandoffSession(sessionId);
	if (!existing || existing.status !== 'pending') {
		throw error(404, 'Session not found or already completed');
	}
	if (!existing.expected_did?.trim()) {
		throw error(404, 'Session is invalid or expired');
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}
	if (body == null || typeof body !== 'object') {
		throw error(400, 'Invalid body');
	}
	const sigil = (body as Record<string, unknown>).sigil;
	if (!isValidSigilShape(sigil)) {
		throw error(400, 'Body must include a valid encrypted Sigil object');
	}

	await initCryptoWasm();
	const sigilRec = sigil as Record<string, unknown>;
	const didFromSigil = didFromSigilPubField(sigilRec);
	if (!didFromSigil || didFromSigil !== existing.expected_did) {
		throw error(400, {
			code: 'SIGIL_DID_MISMATCH',
			message:
				'This encrypted Sigil does not match the identity that started the handoff. Use the Syner persona for the same DID as your SYR account.'
		});
	}

	const sigilJson = JSON.stringify(sigil);
	const ok = await completeSigilHandoffSession(sessionId, sigilJson);
	if (!ok) {
		throw error(409, 'Could not complete handoff');
	}

	return json({ status: 'ok' });
};
