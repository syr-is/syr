import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteRegistrySignSession, getRegistrySignSession } from '$lib/server/export-verify-store';

/**
 * GET /api/user/registry-sign/[sessionId]/result
 * Browser polls for Syner completion (authenticated).
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	const sessionId = params.sessionId?.trim();
	if (!sessionId) {
		throw error(400, { code: 'BAD_REQUEST', message: 'Missing session' });
	}

	const session = await getRegistrySignSession(sessionId);
	if (!session) {
		throw error(404, { code: 'NOT_FOUND', message: 'Session not found or expired' });
	}
	if (session.user_id !== locals.user.id) {
		throw error(403, { code: 'FORBIDDEN', message: 'This session belongs to another account' });
	}

	if (session.status === 'pending') {
		return json(
			{
				status: 'pending',
				data: null,
				meta: { timestamp: new Date().toISOString() }
			},
			{ status: 202 }
		);
	}

	if (session.status === 'failed') {
		const errMsg = session.result_error ?? 'Signing failed';
		await deleteRegistrySignSession(sessionId);
		return json({
			status: 'failed',
			data: { error: errMsg },
			meta: { timestamp: new Date().toISOString() }
		});
	}

	await deleteRegistrySignSession(sessionId);

	return json({
		status: 'success',
		data: { completed: true },
		meta: { timestamp: new Date().toISOString() }
	});
};
