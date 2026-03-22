import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { stringToRecordId } from '@syr-is/types';
import {
	DEFAULT_MAX_POST_PAYLOAD_BYTES,
	MIN_MAX_POST_PAYLOAD_BYTES,
	MAX_MAX_POST_PAYLOAD_BYTES,
	effectiveMaxPostPayloadBytes
} from '$lib/client/content-limit-config';

const PatchSchema = z.object({
	max_post_payload_bytes: z
		.number()
		.int()
		.min(MIN_MAX_POST_PAYLOAD_BYTES)
		.max(MAX_MAX_POST_PAYLOAD_BYTES)
});

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Unauthorized' });
	}
	const user = await userRepository.findById(locals.user.id);
	if (!user) throw error(404, { code: 'NOT_FOUND', message: 'User not found' });
	return json({
		status: 'success',
		data: {
			max_post_payload_bytes: effectiveMaxPostPayloadBytes(
				user.content_max_post_bytes ?? undefined
			),
			stored_max_post_payload_bytes: user.content_max_post_bytes ?? null,
			default_max_post_payload_bytes: DEFAULT_MAX_POST_PAYLOAD_BYTES,
			hard_min_max_post_payload_bytes: MIN_MAX_POST_PAYLOAD_BYTES,
			hard_max_max_post_payload_bytes: MAX_MAX_POST_PAYLOAD_BYTES
		}
	});
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Unauthorized' });
	}
	let body: unknown;
	try {
		body = await request.json();
	} catch (e) {
		if (e instanceof SyntaxError) {
			throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' });
		}
		throw e;
	}
	const parsed = PatchSchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Invalid body',
			details: z.treeifyError(parsed.error)
		});
	}
	const uid = stringToRecordId.decode(locals.user.id);
	const updated = await userRepository.merge(uid, {
		content_max_post_bytes: parsed.data.max_post_payload_bytes,
		updated_at: new Date()
	});
	if (!updated) throw error(404, { code: 'NOT_FOUND', message: 'User not found' });
	return json({
		status: 'success',
		data: {
			max_post_payload_bytes: effectiveMaxPostPayloadBytes(
				updated.content_max_post_bytes ?? undefined
			),
			stored_max_post_payload_bytes: updated.content_max_post_bytes ?? null
		}
	});
};
