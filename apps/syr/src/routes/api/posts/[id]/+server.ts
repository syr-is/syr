import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { postController } from '$lib/controllers/post.controller';
import { stringToRecordId, PostUpdateSchema } from '@syr-is/types';

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
		const postId = stringToRecordId.decode(params.id);
		const post = await postController.getPost(postId);

		if (!post) {
			throw error(404, {
				code: 'NOT_FOUND',
				message: 'Post not found'
			});
		}

		// Check ownership
		if (post.author_id.toString() !== user.id.toString()) {
			throw error(403, {
				code: 'FORBIDDEN',
				message: 'You do not have permission to view this post'
			});
		}

		return json({
			status: 'success',
			data: post,
			meta: { timestamp: new Date().toISOString() }
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err && 'body' in err) {
			throw err;
		}
		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Failed to get post'
		});
	}
};

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
				message: 'You do not have permission to update this post'
			});
		}

		const body = await request.json();

		// Parse the update data (without id since it's in the URL)
		const data = PostUpdateSchema.omit({ id: true }).partial().parse(body);

		// Merge existing post data with updates, preserving fields not included in the request
		const result = await postController.updatePost({
			id: postId,
			type: data.type ?? existingPost.type,
			content_type: data.content_type ?? existingPost.content_type,
			visibility: data.visibility ?? existingPost.visibility,
			status: data.status ?? existingPost.status,
			title: data.title ?? existingPost.title,
			description: data.description ?? existingPost.description,
			content: data.content ?? existingPost.content,
			media_urls: data.media_urls ?? existingPost.media_urls,
			display_mode: data.display_mode ?? existingPost.display_mode
		});

		return json({
			status: 'success',
			data: result,
			meta: { timestamp: new Date().toISOString() }
		});
	} catch (err) {
		console.error('Post update error:', err);

		if (err && typeof err === 'object' && 'status' in err && 'body' in err) {
			throw err;
		}

		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid post data',
				details: z.treeifyError(err)
			});
		}

		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Failed to update post'
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

		// Delete the post (also cleans up associated uploads)
		await postController.deletePost(postId, user.id);

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
