import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { postController } from '$lib/controllers/post.controller';
import {
	recordIdFromDidAndLocal,
	PostUpdateSchema,
	PostDeleteRequestSchema,
	type SignedMutationEnvelope
} from '@syr-is/types';
import {
	assertPostUpdateSignedMutation,
	assertPostDeleteSigned
} from '$lib/server/signed-mutation.server';

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
		const postId = recordIdFromDidAndLocal('post', params.did, params.id);
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
		const postId = recordIdFromDidAndLocal('post', params.did, params.id);

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

		const body = (await request.json()) as Record<string, unknown>;
		const { signed_mutation, ...rest } = body;

		// Parse the update data (without id since it's in the URL)
		const data = PostUpdateSchema.omit({ id: true }).partial().parse(rest);

		const resolvedType = data.type ?? existingPost.type;

		// Shared fields for all post types
		const basePayload = {
			id: postId,
			type: resolvedType,
			visibility: data.visibility ?? existingPost.visibility,
			status: data.status ?? existingPost.status,
			title: data.title ?? existingPost.title,
			description: data.description ?? existingPost.description
		};

		// Build type-specific payload. When switching type, the other type's fields
		// must be removed via patch (merge ignores undefined and leaves stale fields).
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

		const typeSwitched = existingPost.type !== resolvedType;
		const keysToUnset = typeSwitched
			? resolvedType === 'blog'
				? ['media_urls', 'display_mode']
				: ['content_type', 'content']
			: undefined;

		const { signature } = await assertPostUpdateSignedMutation(
			locals.user.id,
			signed_mutation as SignedMutationEnvelope | undefined,
			existingPost,
			{
				type: updatePayload.type,
				title: updatePayload.title,
				description: updatePayload.description,
				content: updatePayload.content,
				content_type: updatePayload.content_type,
				media_urls: updatePayload.media_urls,
				display_mode: updatePayload.display_mode,
				visibility: updatePayload.visibility,
				status: updatePayload.status
			},
			postId
		);

		const result = await postController.updatePost(updatePayload, keysToUnset, signature);

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

export const DELETE: RequestHandler = async ({ params, locals, request }) => {
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
		const postId = recordIdFromDidAndLocal('post', params.did, params.id);

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

		let signed_mutation: SignedMutationEnvelope | undefined;
		const text = await request.text();
		if (text.trim()) {
			let parsedJson: unknown;
			try {
				parsedJson = JSON.parse(text);
			} catch {
				throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' });
			}
			const parsed = PostDeleteRequestSchema.safeParse(parsedJson);
			if (!parsed.success) {
				throw error(400, {
					code: 'VALIDATION_ERROR',
					message: 'Invalid delete request body',
					details: z.treeifyError(parsed.error)
				});
			}
			signed_mutation = parsed.data.signed_mutation;
		}

		await assertPostDeleteSigned(locals.user.id, signed_mutation, postId);

		// Delete the post record (uploads are preserved in user storage)
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
