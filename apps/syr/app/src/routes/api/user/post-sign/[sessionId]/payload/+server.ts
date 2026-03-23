import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPostSignSession } from '$lib/server/export-verify-store';

/**
 * GET /api/user/post-sign/[sessionId]/payload
 * Syner fetches the pending payload (no cookie; session id is the secret).
 */
export const GET: RequestHandler = async ({ params }) => {
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

	return json({
		status: 'success',
		data: {
			expected_did: session.expected_did,
			requested_device_public_key: session.requested_device_public_key,
			payload: session.payload
		},
		meta: { timestamp: new Date().toISOString() }
	});
};
