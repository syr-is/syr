import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { uploadController } from '$lib/controllers/upload.controller';
import { stringToRecordId } from '@syr-is/types';

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

	try {
		const uploadId = stringToRecordId.decode(params.id);
		const upload = await uploadController.getUpload(uploadId);

		if (!upload) {
			throw error(404, {
				code: 'NOT_FOUND',
				message: 'Upload not found'
			});
		}

		// Check ownership
		if (upload.owner_id.toString() !== user.id.toString()) {
			throw error(403, {
				code: 'FORBIDDEN',
				message: 'You do not have permission to view this upload'
			});
		}

		// Get download URL if upload is completed
		let downloadUrl: string | null = null;
		let isPublic = false;
		if (upload.status === 'completed' && upload.key) {
			const result = await uploadController.getDownloadUrl(uploadId);
			if (result) {
				downloadUrl = result.url;
				isPublic = result.isPublic;
			}
		}

		return json({
			status: 'success',
			data: {
				...upload,
				downloadUrl,
				isPublic
			},
			meta: {
				timestamp: new Date().toISOString()
			}
		});
	} catch (err) {
		console.error('Get upload error:', err);

		// Re-throw SvelteKit errors
		if (err && typeof err === 'object' && 'status' in err && 'body' in err) {
			throw err;
		}

		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Failed to get upload'
		});
	}
};

const UpdateUploadSchema = z
	.object({
		folder_id: z.string().nullable().optional(),
		filename: z.string().min(1).optional()
	})
	.refine((data) => data.folder_id !== undefined || data.filename !== undefined, {
		message: 'At least one field (folder_id or filename) must be provided'
	});

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
		const data = UpdateUploadSchema.parse(body);

		let upload;

		// Handle move operation if folder_id is provided
		if (data.folder_id !== undefined) {
			upload = await uploadController.moveUpload(params.id, user.id, data.folder_id);
		}

		// Handle rename operation if filename is provided
		if (data.filename !== undefined) {
			upload = await uploadController.renameUpload(params.id, user.id, data.filename);
		}

		return json({
			status: 'success',
			data: upload,
			meta: {
				timestamp: new Date().toISOString()
			}
		});
	} catch (err) {
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid request data',
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

		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Failed to update upload'
		});
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
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
		const uploadId = stringToRecordId.decode(params.id);

		// Verify upload exists and user owns it
		const existingUpload = await uploadController.getUpload(uploadId);
		if (!existingUpload) {
			throw error(404, {
				code: 'NOT_FOUND',
				message: 'Upload not found'
			});
		}

		// Check ownership
		if (existingUpload.owner_id.toString() !== user.id.toString()) {
			throw error(403, {
				code: 'FORBIDDEN',
				message: 'You do not have permission to delete this upload'
			});
		}

		// Delete the upload
		await uploadController.deleteUpload(uploadId);

		return json({
			status: 'success',
			message: 'Upload deleted successfully',
			meta: {
				timestamp: new Date().toISOString()
			}
		});
	} catch (err) {
		console.error('Upload deletion error:', err);

		// Re-throw SvelteKit errors
		if (err && typeof err === 'object' && 'status' in err && 'body' in err) {
			throw err;
		}

		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Failed to delete upload'
		});
	}
};
