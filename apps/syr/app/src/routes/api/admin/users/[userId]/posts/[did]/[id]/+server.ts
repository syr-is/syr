import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordIdFromDidAndLocal } from '@syr-is/types';
import { postController } from '$lib/controllers/post.controller';
import { stringToRecordId } from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';

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

	let postId;
	try {
		postId = recordIdFromDidAndLocal('post', params.did, params.id);
	} catch {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid post ID' });
	}

	const post = await postController.getPost(postId);
	if (!post) {
		throw error(404, { code: 'NOT_FOUND', message: 'Post not found' });
	}

	await postController.deletePost(postId, userId);

	return json({ status: 'success' });
};
