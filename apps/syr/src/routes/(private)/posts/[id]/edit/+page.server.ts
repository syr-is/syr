import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { postController } from '$lib/controllers/post.controller';
import { userRepository } from '$lib/repositories/user.repository';
import { stringToRecordId } from '@syr-is/types';

export const load: PageServerLoad = async ({ params, locals }) => {
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

	// Get post by ID
	const post = await postController.getPost(stringToRecordId.decode(params.id));
	if (!post) {
		throw error(404, {
			code: 'NOT_FOUND',
			message: 'Post not found'
		});
	}

	// Verify user owns the post
	if (post.author_id.toString() !== user.id.toString()) {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'You do not have permission to edit this post'
		});
	}

	// Serialize post for client (convert RecordId to string, Date to ISO string)
	const serializedPost = {
		...post,
		id: post.id.toString(),
		author_id: post.author_id.toString(),
		created_at: post.created_at.toISOString(),
		updated_at: post.updated_at.toISOString()
	};

	return {
		post: serializedPost
	};
};
