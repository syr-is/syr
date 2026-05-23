import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { kvService } from '$lib/services/kv';
import { INVITE_CODE_TYPE } from '$lib/instance-config';
import { InviteCodeValueSchema } from '@syr-is/types';

const QuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	size: z.coerce.number().int().min(1).max(100).default(10)
});

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}
	if (locals.user.role !== 'ADMIN') {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'Only instance administrators can manage invite codes'
		});
	}

	const parsed = QuerySchema.safeParse({
		page: url.searchParams.get('page') ?? undefined,
		size: url.searchParams.get('size') ?? undefined
	});
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Invalid query parameters',
			details: z.treeifyError(parsed.error)
		});
	}

	const { page, size } = parsed.data;
	const offset = (page - 1) * size;

	const { data: entries, total } = await kvService.getByTypePage(INVITE_CODE_TYPE, size, offset);

	const data: {
		code: string;
		created_by: string;
		max_uses: number | null;
		uses: number;
		created_at: string;
		reserved_username?: string;
	}[] = [];
	for (const entry of entries) {
		const raw = String(entry.id.id);
		const prefix = `${INVITE_CODE_TYPE}:`;
		const code = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
		const valueParsed = InviteCodeValueSchema.safeParse(entry.value);
		if (!valueParsed.success) {
			console.warn(`[invite-codes] Skipping malformed invite code entry ${raw}`, valueParsed.error);
			continue;
		}
		data.push({
			code,
			created_by: valueParsed.data.created_by,
			max_uses: valueParsed.data.max_uses,
			uses: valueParsed.data.uses,
			created_at: valueParsed.data.created_at,
			...(valueParsed.data.reserved_username
				? { reserved_username: valueParsed.data.reserved_username }
				: {})
		});
	}

	return json({
		status: 'success',
		data,
		pagination: { limit: size, offset, total, has_more: offset + size < total }
	});
};
