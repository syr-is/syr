import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { UploadCreateSchema, UploadUpdateSchema } from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';
import { uploadController } from '$lib/controllers/upload.controller';

export const POST: RequestHandler = async ({ request, locals }) => {
	// Check authentication
	if (!locals.user) {
		throw error(401, 'You must be logged in to upload content!');
	}
	const user = await userRepository.findById(locals.user.id);
	if (!user) {
		throw error(400, 'Invalid User');
	}

	try {
		const body = await request.json();
		const data = UploadCreateSchema.parse(body);
		const result = await uploadController.getPutUrl(user, data);
		return json(result);
	} catch (err) {
		// Handle Zod validation errors
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid upload data',
				details: z.treeifyError(err)
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
		throw error(401, 'You must be logged in to update an upload');
	}
	try {
		const body = await request.json();
		const data = UploadUpdateSchema.parse(body);
		const result = await uploadController.completeUpload(data.id);
		return json(result);
	} catch (err) {
		// Handle Zod validation errors
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid upload data',
				details: z.treeifyError(err)
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
