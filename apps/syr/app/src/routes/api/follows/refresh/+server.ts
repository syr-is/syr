import { json, error, isHttpError, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { followController, FollowValidationError } from '$lib/controllers/follow.controller';
import { isValidSyrDid } from '@syr-is/did';
import { followRowToJson } from '$lib/server/follow-row-json.server';

const RefreshBodySchema = z.object({
	followed_did: z.string().min(12)
});

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	}
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid JSON' });
	}
	const parsed = RefreshBodySchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'followed_did required',
			details: z.treeifyError(parsed.error)
		});
	}
	if (!isValidSyrDid(parsed.data.followed_did)) {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid did:syr' });
	}
	try {
		const row = await followController.refreshFollowProvider(
			locals.user.id,
			parsed.data.followed_did
		);
		return json({ status: 'success', data: followRowToJson(row) });
	} catch (e) {
		if (isHttpError(e)) throw e;
		if (e instanceof FollowValidationError) {
			throw error(400, { code: 'VALIDATION_ERROR', message: e.message });
		}
		console.error('follow refresh:', e);
		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Refresh failed'
		});
	}
};
