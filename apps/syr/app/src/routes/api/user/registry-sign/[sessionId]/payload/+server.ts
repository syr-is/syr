import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRegistrySignSession } from '$lib/server/export-verify-store';

/**
 * GET /api/user/registry-sign/[sessionId]/payload
 * Syner fetches signing material (no cookie).
 */
export const GET: RequestHandler = async ({ params }) => {
	const sessionId = params.sessionId?.trim();
	if (!sessionId) {
		throw error(400, { code: 'BAD_REQUEST', message: 'Missing session' });
	}

	const session = await getRegistrySignSession(sessionId);
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
			action: session.action,
			registry_url: session.registry_url,
			sign_object: session.sign_object,
			canonical_payload: session.canonical_payload,
			directory_sign_object: session.directory_sign_object,
			directory_canonical_payload: session.directory_canonical_payload
		},
		meta: { timestamp: new Date().toISOString() }
	});
};
