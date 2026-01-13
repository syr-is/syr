import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { userRepository } from '$lib/repositories/user.repository';
import { postController } from '$lib/controllers/post.controller';
import { stringToRecordId } from '@syr-is/types';

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
		// Convert string ID to RecordId
		const postId = stringToRecordId.decode(params.id);

		// Verify post exists and user owns it
		const existingPost = await postController.getPost(postId);
		if (!existingPost) {
			throw error(404, {
				code: 'NOT_FOUND',
				message: 'Post not found'
			});
		}

		// Check ownership
		if (existingPost.author_id.toString() !== user.id.toString()) {
			throw error(403, {
				code: 'FORBIDDEN',
				message: 'You do not have permission to delete this post'
			});
		}

		// Delete the post
		await postController.deletePost(postId);

		return json({
			status: 'success',
			message: 'Post deleted successfully',
			meta: {
				timestamp: new Date().toISOString()
			}
		});
	} catch (err) {
		console.error('Post deletion error:', err);

		// Re-throw SvelteKit errors
		if (err && typeof err === 'object' && 'status' in err && 'body' in err) {
			throw err;
		}

		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Failed to delete post'
		});
	}
};
