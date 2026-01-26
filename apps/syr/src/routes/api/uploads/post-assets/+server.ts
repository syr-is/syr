import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { UploadCreateSchema } from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';
import { uploadController } from '$lib/controllers/upload.controller';

/**
 * Upload endpoint for post assets
 * Files uploaded here go to: uploads/{user_id}/posts/{post_id}/public/
 * Folder hierarchy on uploads page: posts/{post_id}/public/{upload_id}
 * These files are publicly accessible for embedding in posts
 */

const PostAssetUploadSchema = UploadCreateSchema.extend({
	post_id: z.string().min(1, 'Post ID is required')
});

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'You must be logged in to upload post assets'
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
		const data = PostAssetUploadSchema.parse(body);
		const { post_id, ...uploadData } = data;

		const result = await uploadController.getPostAssetPutUrl(user, post_id, uploadData);

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
		if (err instanceof Error) {
			throw error(400, {
				code: 'BAD_REQUEST',
				message: err.message
			});
		}
		throw err;
	}
};
