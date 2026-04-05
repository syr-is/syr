import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kvService } from '$lib/services/kv';
import { INVITE_CODE_TYPE } from '$lib/instance-config';
import type { InviteCodeValue } from '@syr-is/types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}
	if (locals.user.role !== 'ADMIN') {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'Only instance administrators can manage invite codes'
		});
	}

	const entry = await kvService.getEntry(INVITE_CODE_TYPE, params.code);
	if (!entry) {
		throw error(404, { code: 'NOT_FOUND', message: 'Invite code not found' });
	}

	const value = entry.value as InviteCodeValue;
	return json({
		status: 'success',
		data: {
			code: params.code,
			created_by: value.created_by,
			max_uses: value.max_uses,
			uses: value.uses,
			created_at: value.created_at
		}
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}
	if (locals.user.role !== 'ADMIN') {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'Only instance administrators can manage invite codes'
		});
	}

	await kvService.delete(INVITE_CODE_TYPE, params.code);
	return json({ status: 'success' });
};
