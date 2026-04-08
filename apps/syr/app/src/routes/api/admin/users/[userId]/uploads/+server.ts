import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { stringToRecordId, extractDid, extractLocalId } from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';
import { uploadRepository } from '$lib/repositories/upload.repository';

const QuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	size: z.coerce.number().int().min(1).max(100).default(20),
	sort_field: z.enum(['created_at', 'updated_at', 'filename', 'size']).default('created_at'),
	sort_order: z.enum(['asc', 'desc']).default('desc'),
	folder_id: z.string().optional()
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
		size: url.searchParams.get('size') ?? undefined,
		sort_field: url.searchParams.get('sort_field') ?? undefined,
		sort_order: url.searchParams.get('sort_order') ?? undefined,
		folder_id: url.searchParams.get('folder_id') ?? undefined
	});
	if (!parsed.success) {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid query parameters' });
	}

	const { page, size, sort_field, sort_order, folder_id } = parsed.data;
	const offset = (page - 1) * size;

	// Build filters
	const filters: Record<string, unknown> = { owner_id: userId };

	// folder_id semantics: absent = all uploads, empty string = root only, value = specific folder
	const rawFolderId = url.searchParams.get('folder_id');
	if (rawFolderId !== null) {
		if (rawFolderId === '') {
			filters.folder_id = null; // root level only
		} else if (folder_id) {
			try {
				filters.folder_id = stringToRecordId.decode(folder_id);
			} catch {
				throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid folder ID' });
			}
		}
	}

	const { data: uploads, total } = await uploadRepository.findMany({
		limit: size,
		offset,
		sort: { field: sort_field, order: sort_order },
		filters
	});

	const data = uploads.map((u) => {
		let did: string | null = null;
		let local_id: string | null = null;
		try {
			did = extractDid(u.id);
			local_id = extractLocalId(u.id);
		} catch {
			// non-composite ID
		}
		return {
			id: u.id.toString(),
			did,
			local_id,
			filename: u.filename,
			mime_type: u.mime_type,
			size: u.size,
			status: u.status,
			is_public: u.is_public,
			key: u.key ?? null,
			folder_id: u.folder_id?.toString() ?? null,
			url: u.url ?? null,
			created_at: u.created_at.toISOString()
		};
	});

	return json({
		status: 'success',
		data,
		pagination: { limit: size, offset, total, has_more: offset + size < total }
	});
};
