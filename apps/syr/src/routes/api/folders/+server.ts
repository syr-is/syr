import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { FolderCreateSchema } from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';
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

	// Get parent_id from query params (null for root folders)
	const parentId = url.searchParams.get('parent_id') || null;

	const folders = await folderController.getFolders(user.id, parentId);

	// If a parent_id is provided, also get breadcrumbs
	const breadcrumbs = parentId ? await folderController.getBreadcrumbs(parentId) : [];

	return json({
		status: 'success',
		data: {
			folders,
			breadcrumbs
		},
		meta: { timestamp: new Date().toISOString() }
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'You must be logged in to create folders'
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
		const data = FolderCreateSchema.parse(body);
		const folder = await folderController.createFolder(user.id, data);

		return json(
			{
				status: 'success',
				data: folder,
				meta: { timestamp: new Date().toISOString() }
			},
			{ status: 201 }
		);
	} catch (err) {
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid folder data',
				details: z.treeifyError(err)
			});
		}
		if (err instanceof Error) {
			throw error(400, {
				code: 'BAD_REQUEST',
				message: err.message
			});
		}
		throw err;
	}
};
