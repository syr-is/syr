import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { UploadCreateSchema } from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';
import { uploadController } from '$lib/controllers/upload.controller';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'You must be logged in to upload a story'
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
		const uploadData = UploadCreateSchema.parse(body);
		const result = await uploadController.getStoryPutUrl(user, uploadData);

		return json(
			{
				status: 'success',
				data: result,
				meta: { timestamp: new Date().toISOString() }
			},
			{ status: 201 }
		);
	} catch (err) {
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid upload data',
				details: z.treeifyError(err)
			});
		}
		if (err instanceof Error && err.message.includes('Storage limit')) {
			throw error(413, {
				code: 'STORAGE_LIMIT_EXCEEDED',
				message: err.message
			});
		}
		throw err;
	}
};
