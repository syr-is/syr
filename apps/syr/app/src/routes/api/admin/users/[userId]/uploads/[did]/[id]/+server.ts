import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordIdFromDidAndLocal, stringToRecordId } from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';
import { uploadController } from '$lib/controllers/upload.controller';

export const DELETE: RequestHandler = async ({ params, locals }) => {
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

	let uploadId;
	try {
		uploadId = recordIdFromDidAndLocal('upload', params.did, params.id);
	} catch {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid upload ID' });
	}

	try {
		await uploadController.deleteUpload(uploadId);
	} catch (err) {
		if (err instanceof Error && err.message === 'Upload not found') {
			throw error(404, { code: 'NOT_FOUND', message: 'Upload not found' });
		}
		throw err;
	}

	return json({ status: 'success' });
};
