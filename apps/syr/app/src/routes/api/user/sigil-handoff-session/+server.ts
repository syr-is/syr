import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSigilHandoffSession } from '$lib/server/export-verify-store';
import { config } from '$lib/config';

/**
 * POST /api/user/sigil-handoff-session
 * Start a Syner → browser encrypted Sigil transfer. Returns deeplink for QR / “Open Syner”.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const did = locals.user.did?.trim();
	if (!did || !did.startsWith('did:syr:')) {
		throw error(400, {
			code: 'BAD_REQUEST',
			message: 'Your account needs a DID before receiving a Sigil from Syner.'
		});
	}

	const sessionId = await createSigilHandoffSession(locals.user.id, did);
	const origin = config.PUBLIC_URL.replace(/\/$/, '');
	const deeplinkUrl =
		`syr://sigil-handoff?origin=${encodeURIComponent(origin)}` +
		`&session=${encodeURIComponent(sessionId)}` +
		`&did=${encodeURIComponent(did)}`;

	return json({
		data: {
			session_id: sessionId,
			deeplink_url: deeplinkUrl,
			expires_in_sec: 300
		}
	});
};
