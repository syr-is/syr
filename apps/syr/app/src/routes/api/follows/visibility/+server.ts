import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { isValidSyrDid } from '@syr-is/did';
import { followRepository } from '$lib/repositories/follow.repository';
import { followRowToJson } from '$lib/server/follow-row-json.server';

const VisibilitySchema = z.object({
	followed_did: z.string().min(12),
	followed_provider_url: z.string().url().optional(),
	is_public: z.boolean()
});

/**
 * PATCH /api/follows/visibility
 * Toggle the public visibility of a follow.
 */
export const PATCH: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	}
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid JSON' });
	}
	const parsed = VisibilitySchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'followed_did and is_public required',
			details: z.treeifyError(parsed.error)
		});
	}
	if (!isValidSyrDid(parsed.data.followed_did)) {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid did:syr' });
	}

	const row = await followRepository.setPublic(
		locals.user.id,
		parsed.data.followed_did,
		parsed.data.followed_provider_url,
		parsed.data.is_public
	);
	if (!row) {
		throw error(404, { code: 'NOT_FOUND', message: 'Follow not found' });
	}

	return json({ status: 'success', data: followRowToJson(row) });
};
