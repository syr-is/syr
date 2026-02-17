import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { sessionRepository } from '$lib/repositories/session.repository';
import { stringToRecordId } from '@syr-is/types';

const QuerySchema = z.object({
	page: z.coerce.number().int().positive(),
	size: z.coerce
		.number()
		.int()
		.positive()
		.refine((v) => [5, 10, 20].includes(v), 'size must be 5, 10 or 20')
});

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'Unauthorized'
		});
	}

	const parsed = QuerySchema.safeParse({
		page: url.searchParams.get('page'),
		size: url.searchParams.get('size')
	});

	if (!parsed.success) {
		throw error(400, {
			code: 'BAD_REQUEST',
			message: 'Missing or invalid page/size',
			details: z.treeifyError(parsed.error)
		});
	}

	const { page, size } = parsed.data;
	const offset = (page - 1) * size;
	const limit = size;

	const { data, total } = await sessionRepository.findMany({
		limit,
		offset,
		sort: { field: 'created_at', order: 'desc' },
		filters: { user_id: stringToRecordId.decode(locals.user.id) }
	});

	const items = data.map((s) => ({
		id: s.id.toString(),
		ip: s.ip,
		user_agent: s.user_agent,
		created_at: s.created_at.toISOString(),
		last_active: s.last_active ? s.last_active.toISOString() : undefined,
		expires_at: s.expires_at.toISOString(),
		is_current: s.id.toString() === locals.user?.sessionId
	}));

	return json({
		status: 'success',
		data: items,
		pagination: {
			limit,
			offset,
			total,
			has_more: offset + items.length < total
		},
		meta: { timestamp: new Date().toISOString() }
	});
};
