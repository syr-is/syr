import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deletePostSignSession, getPostSignSession } from '$lib/server/export-verify-store';

/**
 * GET /api/user/post-sign/[sessionId]/result
 * Browser polls for completed `signed_mutation` (authenticated).
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	const sessionId = params.sessionId?.trim();
	if (!sessionId) {
		throw error(400, { code: 'BAD_REQUEST', message: 'Missing session' });
	}

	const session = await getPostSignSession(sessionId);
	if (!session) {
		throw error(404, { code: 'NOT_FOUND', message: 'Session not found or expired' });
	}
	if (session.user_id !== locals.user.id) {
		throw error(403, { code: 'FORBIDDEN', message: 'This session belongs to another account' });
	}

	if (session.status !== 'complete' || !session.signed_mutation) {
		return json(
			{
				status: 'pending',
				data: null,
				meta: { timestamp: new Date().toISOString() }
			},
			{ status: 202 }
		);
	}

	const signed_mutation = session.signed_mutation;
	await deletePostSignSession(sessionId);

	return json({
		status: 'success',
		data: { signed_mutation },
		meta: { timestamp: new Date().toISOString() }
	});
};
