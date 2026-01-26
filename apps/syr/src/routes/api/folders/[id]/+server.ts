import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { FolderUpdateSchema } from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';
import { folderController } from '$lib/controllers/folder.controller';

export const GET: RequestHandler = async ({ params, locals }) => {
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

	const folder = await folderController.getFolder(params.id);
	if (!folder) {
		throw error(404, {
			code: 'NOT_FOUND',
			message: 'Folder not found'
		});
	}

	// Verify ownership
	if (folder.owner_id.toString() !== user.id.toString()) {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'You do not have permission to view this folder'
		});
	}

	// Get additional info
	const [path, isPublic, breadcrumbs] = await Promise.all([
		folderController.getFolderPath(params.id),
		folderController.isPublic(params.id),
		folderController.getBreadcrumbs(params.id)
	]);

	return json({
		status: 'success',
		data: {
			folder,
			path,
			isPublic,
			breadcrumbs
		},
		meta: { timestamp: new Date().toISOString() }
	});
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
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

	try {
		const body = await request.json();
		const data = FolderUpdateSchema.parse(body);
		const folder = await folderController.updateFolder(params.id, user.id, data);

		return json({
			status: 'success',
			data: folder,
			meta: { timestamp: new Date().toISOString() }
		});
	} catch (err) {
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid folder data',
				details: z.treeifyError(err)
			});
		}
		if (err instanceof Error) {
			if (err.message.includes('not found')) {
				throw error(404, {
					code: 'NOT_FOUND',
					message: err.message
				});
			}
			if (err.message.includes('permission')) {
				throw error(403, {
					code: 'FORBIDDEN',
					message: err.message
				});
			}
			throw error(400, {
				code: 'BAD_REQUEST',
				message: err.message
			});
		}
		throw err;
	}
};

export const DELETE: RequestHandler = async ({ params, url, locals }) => {
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

	const deleteContents = url.searchParams.get('delete_contents') === 'true';

	try {
		await folderController.deleteFolder(params.id, user.id, deleteContents);

		return json({
			status: 'success',
			message: 'Folder deleted successfully',
			meta: { timestamp: new Date().toISOString() }
		});
	} catch (err) {
		if (err instanceof Error) {
			if (err.message.includes('not found')) {
				throw error(404, {
					code: 'NOT_FOUND',
					message: err.message
				});
			}
			if (err.message.includes('permission') || err.message.includes('Cannot delete')) {
				throw error(403, {
					code: 'FORBIDDEN',
					message: err.message
				});
			}
			throw error(400, {
				code: 'BAD_REQUEST',
				message: err.message
			});
		}
		throw err;
	}
};
