import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stringToRecordId } from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';
import { folderController } from '$lib/controllers/folder.controller';

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

	const parentId = url.searchParams.get('parent_id') || null;

	const folders = await folderController.getFolders(userId, parentId);
	const breadcrumbs = parentId ? await folderController.getBreadcrumbs(parentId) : [];

	return json({
		status: 'success',
		data: {
			folders: folders.map((f) => ({
				id: f.id.toString(),
				name: f.name,
				parent_id: f.parent_id?.toString() ?? null,
				created_at: f.created_at.toISOString()
			})),
			breadcrumbs
		}
	});
};
