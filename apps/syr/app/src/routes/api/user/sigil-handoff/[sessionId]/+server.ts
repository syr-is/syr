import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	consumeSigilHandoffPayload,
	getSigilHandoffSession
} from '$lib/server/export-verify-store';

/**
 * GET /api/user/sigil-handoff/[sessionId]
 * Poll until Syner has uploaded encrypted Sigil; returns payload once then consumes the session.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const sessionId = params.sessionId?.trim();
	if (!sessionId) throw error(400, 'Missing session');

	const pending = await getSigilHandoffSession(sessionId);
	if (!pending) {
		return json({ data: { status: 'gone' as const } });
	}
	if (pending.user_id !== locals.user.id) {
		throw error(403, 'Not authorized');
	}
	if (pending.status === 'pending') {
		return json({ data: { status: 'pending' as const } });
	}
	if (pending.status !== 'complete') {
		return json({ data: { status: 'gone' as const } });
	}

	const sigilJson = await consumeSigilHandoffPayload(sessionId, locals.user.id);
	if (!sigilJson) {
		return json({ data: { status: 'gone' as const } });
	}

	return json({
		data: {
			status: 'ready' as const,
			sigil_json: sigilJson
		}
	});
};
