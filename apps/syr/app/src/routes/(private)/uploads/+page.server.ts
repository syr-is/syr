import type { PageServerLoad } from './$types';
import { folderController } from '$lib/controllers/folder.controller';
import { userRepository } from '$lib/repositories/user.repository';

export const load: PageServerLoad = async ({ locals, url }) => {
	const pathParam = url.searchParams.get('path');

	// If no path param or no user, return with null folder
	if (!pathParam || !locals.user) {
		return {
			user: locals.user,
			initialFolderId: null
		};
	}

	try {
		const user = await userRepository.findById(locals.user.id);
		if (!user) {
			return {
				user: locals.user,
				initialFolderId: null
			};
		}

		// Try to get the folder and verify ownership
		const folder = await folderController.getFolder(pathParam);
		if (!folder) {
			// Folder doesn't exist
			return {
				user: locals.user,
				initialFolderId: null,
				invalidPath: true
			};
		}

		// Verify the folder belongs to the user
		if (folder.owner_id.toString() !== user.id.toString()) {
			// User doesn't own this folder
			return {
				user: locals.user,
				initialFolderId: null,
				invalidPath: true
			};
		}

		// Valid folder that user owns
		return {
			user: locals.user,
			initialFolderId: pathParam
		};
	} catch {
		// Any error - return null folder
		return {
			user: locals.user,
			initialFolderId: null,
			invalidPath: true
		};
	}
};
