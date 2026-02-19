import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { UploadCreateSchema } from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';
import { uploadController } from '$lib/controllers/upload.controller';

/**
 * Upload endpoint for post assets
 * Files uploaded here go to: uploads/{did}/posts/{post_ulid}/public/
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

		// post_id comes as "did:syr:z6Mk.../01JMXYZ" from the client - extract just the local ID
		const slashIdx = post_id.lastIndexOf('/');
		const postLocalId = slashIdx !== -1 ? post_id.substring(slashIdx + 1) : post_id;

		const result = await uploadController.getPostAssetPutUrl(user, postLocalId, uploadData);

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
		// Handle storage limit errors
		if (err instanceof Error && err.message.includes('Storage limit')) {
			throw error(413, {
				code: 'STORAGE_LIMIT_EXCEEDED',
				message: err.message
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
