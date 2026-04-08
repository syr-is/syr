import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { stringToRecordId, extractDid, extractLocalId } from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';
import { postController } from '$lib/controllers/post.controller';

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

	const { data: posts, total } = await postController.getUserPosts(userId, {
		limit: size,
		offset,
		sort: { field: 'created_at', order: 'desc' }
	});

	const data = posts.map((p) => {
		let did: string | null = null;
		let local_id: string | null = null;
		try {
			did = extractDid(p.id);
			local_id = extractLocalId(p.id);
		} catch {
			// non-composite ID
		}
		return {
			id: p.id.toString(),
			did,
			local_id,
			type: p.type,
			title: p.title ?? null,
			visibility: p.visibility,
			status: p.status,
			created_at: p.created_at.toISOString()
		};
	});

	return json({
		status: 'success',
		data,
		pagination: { limit: size, offset, total, has_more: offset + size < total }
	});
};
