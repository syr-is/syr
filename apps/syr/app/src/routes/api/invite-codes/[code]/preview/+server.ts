import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kvService } from '$lib/services/kv';
import { INVITE_CODE_TYPE } from '$lib/instance-config';
import type { InviteCodeValue } from '@syr-is/types';

/**
 * GET /api/invite-codes/{code}/preview
 *
 * Public endpoint — no auth required. Returns minimal info about an invite
 * code so the registration form can prefill the reserved username.
 * Does NOT expose internal details (creator, uses, etc.).
 */
export const GET: RequestHandler = async ({ params }) => {
	const entry = await kvService.getEntry(INVITE_CODE_TYPE, params.code);
	if (!entry) {
		throw error(404, { code: 'NOT_FOUND', message: 'Invite code not found' });
	}

	const value = entry.value as InviteCodeValue;
	const exhausted = value.max_uses !== null && value.uses >= value.max_uses;

	return json({
		status: 'success',
		data: {
			valid: !exhausted,
			reserved_username: value.reserved_username ?? null
		}
	});
};
