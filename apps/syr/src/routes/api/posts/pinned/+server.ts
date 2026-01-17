import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { pinnedPostsController } from '$lib/controllers/pinned-posts.controller';

/**
 * GET /api/posts/pinned
 * Get user's pinned posts in order
 */
export const GET: RequestHandler = async ({ locals }) => {
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

	const pinnedPosts = await pinnedPostsController.getPinnedPosts(user.id);
	const pinnedPostIds = await pinnedPostsController.getPinnedPostIds(user.id);

	return json({
		status: 'success',
		data: {
			posts: pinnedPosts,
			post_ids: pinnedPostIds
		},
		meta: { timestamp: new Date().toISOString() }
	});
};

/**
 * Schema for pin/unpin action
 */
const PinActionSchema = z.object({
	post_id: z.string(),
	action: z.enum(['pin', 'unpin'])
});

/**
 * POST /api/posts/pinned
 * Pin or unpin a post
 */
export const POST: RequestHandler = async ({ request, locals }) => {
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
		const { post_id, action } = PinActionSchema.parse(body);

		let result;
		if (action === 'pin') {
			result = await pinnedPostsController.pinPost(user, post_id);
		} else {
			result = await pinnedPostsController.unpinPost(user, post_id);
		}

		if (!result.success) {
			throw error(400, {
				code: 'BAD_REQUEST',
				message: result.message || 'Operation failed'
			});
		}

		return json({
			status: 'success',
			data: {
				post_ids: result.post_ids
			},
			meta: { timestamp: new Date().toISOString() }
		});
	} catch (err) {
		// Re-throw SvelteKit errors
		if (err && typeof err === 'object' && 'status' in err && 'body' in err) {
			throw err;
		}

		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid request data',
				details: z.treeifyError(err)
			});
		}

		console.error('Pin action error:', err);
		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Failed to process pin action'
		});
	}
};

/**
 * Schema for reorder action
 */
const ReorderSchema = z.object({
	post_ids: z.array(z.string())
});

/**
 * PATCH /api/posts/pinned
 * Reorder pinned posts
 */
export const PATCH: RequestHandler = async ({ request, locals }) => {
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
		const { post_ids } = ReorderSchema.parse(body);

		const result = await pinnedPostsController.reorderPinnedPosts(user, post_ids);

		if (!result.success) {
			throw error(400, {
				code: 'BAD_REQUEST',
				message: result.message || 'Reorder failed'
			});
		}

		return json({
			status: 'success',
			data: {
				post_ids: result.post_ids
			},
			meta: { timestamp: new Date().toISOString() }
		});
	} catch (err) {
		// Re-throw SvelteKit errors
		if (err && typeof err === 'object' && 'status' in err && 'body' in err) {
			throw err;
		}

		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid request data',
				details: z.treeifyError(err)
			});
		}

		console.error('Reorder error:', err);
		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Failed to reorder pinned posts'
		});
	}
};
