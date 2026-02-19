import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { postController } from '$lib/controllers/post.controller';
import {
	QueryParamsSchema,
	QueryOptionsSchema,
	PostCreateSchema,
	PostUpdateSchema,
	recordIdFromDidAndLocal,
	extractDid,
	extractLocalId
} from '@syr-is/types';
import { resolveMediaUrlMetadata } from '$lib/utils/post-media.server';

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

	// Resolve mime types and filenames for all media URLs across all posts
	const allMediaUrls = data.flatMap((p) =>
		p.type === 'media' && p.media_urls ? p.media_urls : []
	);
	const { mimeTypes: mediaUrlMimeTypes, filenames: mediaUrlFilenames } =
		allMediaUrls.length > 0
			? await resolveMediaUrlMetadata(allMediaUrls)
			: { mimeTypes: {}, filenames: {} };

	const serializedData = data.map((post) => ({
		...post,
		id: post.id.toString(),
		did: extractDid(post.id),
		local_id: extractLocalId(post.id),
		author_id: post.author_id.toString()
	}));

	return json({
		status: 'success',
		data: serializedData,
		mediaUrlMimeTypes,
		mediaUrlFilenames,
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

	if (!user.did) {
		throw error(400, {
			code: 'IDENTITY_REQUIRED',
			message: 'You must create an identity before creating posts'
		});
	}

	try {
		const body = await request.json();
		const data = PostCreateSchema.parse(body);
		const result = await postController.createPost(user, data);

		// user.did guard above and postController.createPost(user, data) guarantee result.id is a composite record ID
		return json(
			{
				status: 'success',
				data: {
					...result,
					id: result.id.toString(),
					did: extractDid(result.id),
					local_id: extractLocalId(result.id),
					author_id: result.author_id.toString()
				},
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
		// Convert DID + local_id to composite RecordId
		if (body.did && body.local_id) {
			body.id = recordIdFromDidAndLocal('post', body.did, body.local_id);
			delete body.did;
			delete body.local_id;
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

		// When switching post type, explicitly remove stale fields from the old type.
		// merge() alone won't clear undefined values in SurrealDB.
		const resolvedType = data.type ?? existingPost.type;
		const typeSwitched = existingPost.type !== resolvedType;
		const keysToUnset = typeSwitched
			? resolvedType === 'blog'
				? ['media_urls', 'display_mode']
				: ['content_type', 'content']
			: undefined;

		// Build payload with fallbacks so required fields are always set (e.g. content_type for blog).
		// Raw data may omit these when switching media→blog, which would fail PostSchema validation.
		const basePayload = {
			id: data.id,
			type: resolvedType,
			visibility: data.visibility ?? existingPost.visibility,
			status: data.status ?? existingPost.status,
			title: data.title ?? existingPost.title,
			description: data.description ?? existingPost.description
		};
		const updatePayload =
			resolvedType === 'blog'
				? {
						...basePayload,
						content_type: data.content_type ?? existingPost.content_type ?? 'markdown',
						content: data.content ?? existingPost.content ?? '',
						media_urls: undefined,
						display_mode: undefined
					}
				: {
						...basePayload,
						content_type: undefined,
						content: undefined,
						media_urls: data.media_urls ?? existingPost.media_urls ?? [],
						display_mode: data.display_mode ?? existingPost.display_mode ?? 'masonry'
					};

		const result = await postController.updatePost(updatePayload, keysToUnset);

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
