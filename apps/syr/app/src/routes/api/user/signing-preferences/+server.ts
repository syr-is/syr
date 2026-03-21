import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { stringToRecordId } from '@syr-is/types';

const PatchSchema = z.object({
	signing_warn_before_each_action: z.boolean().optional(),
	signing_require_explicit_sign_button: z.boolean().optional()
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
			signing_warn_before_each_action: user.signing_warn_before_each_action ?? true,
			signing_require_explicit_sign_button: user.signing_require_explicit_sign_button ?? true
		}
	});
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Unauthorized' });
	}
	const body = await request.json();
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
		...parsed.data,
		updated_at: new Date()
	});
	if (!updated) throw error(404, { code: 'NOT_FOUND', message: 'User not found' });
	return json({
		status: 'success',
		data: {
			signing_warn_before_each_action: updated.signing_warn_before_each_action ?? true,
			signing_require_explicit_sign_button: updated.signing_require_explicit_sign_button ?? true
		}
	});
};
