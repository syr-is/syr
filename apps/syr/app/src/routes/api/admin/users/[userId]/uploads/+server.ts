import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { stringToRecordId } from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';
import { uploadRepository } from '$lib/repositories/upload.repository';

const QuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	size: z.coerce.number().int().min(1).max(100).default(20)
});

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}
	if (locals.user.role !== 'ADMIN') {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'Only instance administrators can manage users'
		});
	}

	let userId;
	try {
		userId = stringToRecordId.decode(params.userId);
	} catch {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid user ID' });
	}

	const user = await userRepository.findById(userId);
	if (!user) {
		throw error(404, { code: 'NOT_FOUND', message: 'User not found' });
	}

	const parsed = QuerySchema.safeParse({
		page: url.searchParams.get('page') ?? undefined,
		size: url.searchParams.get('size') ?? undefined
	});
	if (!parsed.success) {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid query parameters' });
	}

	const { page, size } = parsed.data;
	const offset = (page - 1) * size;

	const { data: uploads, total } = await uploadRepository.findMany({
		limit: size,
		offset,
		sort: { field: 'created_at', order: 'desc' },
		filters: { owner_id: userId }
	});

	const data = uploads.map((u) => ({
		id: u.id.toString(),
		filename: u.filename,
		mime_type: u.mime_type,
		size: u.size,
		status: u.status,
		is_public: u.is_public,
		created_at: u.created_at.toISOString()
	}));

	return json({
		status: 'success',
		data,
		pagination: { limit: size, offset, total, has_more: offset + size < total }
	});
};
