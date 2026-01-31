import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import {
	UploadCreateSchema,
	UploadUpdateSchema,
	QueryParamsSchema,
	QueryOptionsSchema
} from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';
import { uploadController } from '$lib/controllers/upload.controller';
import { folderController } from '$lib/controllers/folder.controller';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'Unauthorized'
		});
	}

	const user = await userRepository.findById(locals.user.id);
	if (!user) {
		throw error(400, {
			code: 'BAD_REQUEST',
			message: 'Invalid User'
		});
	}

	// Parse query parameters
	const getParam = (key: string): string | undefined => {
		const value = url.searchParams.get(key);
		return value === null || value === '' ? undefined : value;
	};

	const parsed = QueryParamsSchema.safeParse({
		limit: getParam('limit'),
		offset: getParam('offset'),
		sort_field: getParam('sort_field'),
		sort_order: getParam('sort_order'),
		search: getParam('search')
	});

	if (!parsed.success) {
		throw error(400, {
			code: 'BAD_REQUEST',
			message: 'Invalid query parameters',
			details: z.treeifyError(parsed.error)
		});
	}

	const options = QueryOptionsSchema.partial().parse(parsed.data);
	const { limit = 20, offset = 0 } = options;

	// Get folder_id from query params
	// null = root level only, undefined = all files, string = specific folder
	const folderIdParam = url.searchParams.get('folder_id');
	const folderId = folderIdParam === '' ? null : folderIdParam;

	const { data, total } = await uploadController.getUserUploads(user.id, {
		...options,
		folder_id: folderId
	});

	// Get breadcrumbs if viewing a folder
	const breadcrumbs = folderId ? await folderController.getBreadcrumbs(folderId) : [];

	return json({
		status: 'success',
		data,
		breadcrumbs,
		pagination: {
			limit,
			offset,
			total,
			has_more: offset + data.length < total
		},
		meta: { timestamp: new Date().toISOString() }
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	// Check authentication
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'You must be logged in to upload content!'
		});
	}
	const user = await userRepository.findById(locals.user.id);
	if (!user) {
		throw error(400, {
			code: 'BAD_REQUEST',
			message: 'Invalid User'
		});
	}

	try {
		const body = await request.json();
		const data = UploadCreateSchema.parse(body);
		const result = await uploadController.getPutUrl(user, data);
		return json(
			{
				status: 'success',
				data: result,
				meta: { timestamp: new Date().toISOString() }
			},
			{ status: 201 }
		);
	} catch (err) {
		// Handle Zod validation errors
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid upload data',
				details: z.treeifyError(err)
			});
		}
		// Handle storage limit errors
		if (err instanceof Error && err.message.includes('Storage limit')) {
			throw error(413, {
				code: 'STORAGE_LIMIT_EXCEEDED',
				message: err.message
			});
		}
		// Handle repository validation errors
		if (err instanceof Error && err.message.includes('Validation failed')) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: err.message
			});
		}
		// Re-throw unexpected errors
		throw err;
	}
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'You must be logged in to update an upload'
		});
	}
	try {
		const body = await request.json();
		const data = UploadUpdateSchema.parse(body);
		const result = await uploadController.completeUpload(data.id);
		return json({
			status: 'success',
			data: result,
			meta: { timestamp: new Date().toISOString() }
		});
	} catch (err) {
		// Handle Zod validation errors
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid upload data',
				details: z.treeifyError(err)
			});
		}
		// Handle file verification errors (size/checksum mismatch)
		if (err instanceof Error && err.message.includes('mismatch')) {
			throw error(400, {
				code: 'FILE_VERIFICATION_FAILED',
				message: err.message
			});
		}
		// Handle upload not found or already completed
		if (
			err instanceof Error &&
			(err.message.includes('not found') || err.message.includes('already completed'))
		) {
			throw error(400, {
				code: 'BAD_REQUEST',
				message: err.message
			});
		}
		// Handle repository validation errors
		if (err instanceof Error && err.message.includes('Validation failed')) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: err.message
			});
		}
		// Re-throw unexpected errors
		throw err;
	}
};
