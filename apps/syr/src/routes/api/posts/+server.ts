import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { postController } from '$lib/controllers/post.controller';
import {
	QueryParamsSchema,
	QueryOptionsSchema,
	PostCreateSchema,
	PostUpdateSchema
} from '@syr-is/types';

export const GET: RequestHandler = async ({ url, locals }) => {
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

	// Parse query parameters and transform to QueryOptions format
	// Convert null/empty string to undefined since URLSearchParams.get() returns null for missing params
	const getParam = (key: string): string | undefined => {
		const value = url.searchParams.get(key);
		return value === null || value === '' ? undefined : value;
	};

	const parsed = QueryParamsSchema.safeParse({
		limit: getParam('limit'),
		offset: getParam('offset'),
		sort_field: getParam('sort_field'),
		sort_order: getParam('sort_order'),
		search: getParam('search')
	});

	if (!parsed.success) {
		throw error(400, {
			code: 'BAD_REQUEST',
			message: 'Invalid query parameters',
			details: z.treeifyError(parsed.error)
		});
	}

	// Validate and merge with defaults using QueryOptionsSchema
	const options = QueryOptionsSchema.partial().parse(parsed.data);
	const { limit = 20, offset = 0 } = options;

	// Get posts with pagination options
	const { data, total } = await postController.getUserPosts(user.id, options);

	return json({
		status: 'success',
		data,
		pagination: {
			limit,
			offset,
			total,
			has_more: offset + data.length < total
		},
		meta: { timestamp: new Date().toISOString() }
	});
};

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
		const data = PostCreateSchema.parse(body);
		const result = await postController.createPost(user, data);

		return json(
			{
				status: 'success',
				data: result,
				meta: {
					timestamp: new Date().toISOString()
				}
			},
			{ status: 201 }
		);
	} catch (err) {
		console.error('Post creation error:', err);

		// Handle Zod validation errors
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid post data',
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

		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Failed to create post'
		});
	}
};

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
		// Convert string ID to RecordId if needed
		if (body.id && typeof body.id === 'string') {
			const { stringToRecordId } = await import('@syr-is/types');
			body.id = stringToRecordId.decode(body.id);
		}
		const data = PostUpdateSchema.parse(body);

		// Verify post exists and user owns it
		const existingPost = await postController.getPost(data.id);
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

		const result = await postController.updatePost(data);

		return json({
			status: 'success',
			data: result,
			meta: {
				timestamp: new Date().toISOString()
			}
		});
	} catch (err) {
		console.error('Post update error:', err);

		// Re-throw SvelteKit errors
		if (err && typeof err === 'object' && 'status' in err && 'body' in err) {
			throw err;
		}

		// Handle Zod validation errors
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid post data',
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

		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Failed to update post'
		});
	}
};
