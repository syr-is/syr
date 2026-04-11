import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { commentController } from '$lib/controllers/comment.controller';
import {
	recordIdFromDidAndLocal,
	CommentUpdateByUrlRequestSchema,
	extractDid,
	extractLocalId
} from '@syr-is/types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	const user = await userRepository.findById(locals.user.id);
	if (!user) throw error(400, { code: 'BAD_REQUEST', message: 'Invalid User' });

	const commentId = recordIdFromDidAndLocal('comment', params.did, params.id);
	const comment = await commentController.getComment(commentId);
	if (!comment) throw error(404, { code: 'NOT_FOUND', message: 'Comment not found' });
	if (comment.author_id.toString() !== user.id.toString()) {
		throw error(403, { code: 'FORBIDDEN', message: 'Not your comment' });
	}

	return json({
		status: 'success',
		data: {
			...comment,
			id: comment.id.toString(),
			did: extractDid(comment.id),
			local_id: extractLocalId(comment.id),
			author_id: comment.author_id.toString()
		}
	});
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	const user = await userRepository.findById(locals.user.id);
	if (!user) throw error(400, { code: 'BAD_REQUEST', message: 'Invalid User' });

	const commentId = recordIdFromDidAndLocal('comment', params.did, params.id);
	const existing = await commentController.getComment(commentId);
	if (!existing) throw error(404, { code: 'NOT_FOUND', message: 'Comment not found' });
	if (existing.author_id.toString() !== user.id.toString()) {
		throw error(403, { code: 'FORBIDDEN', message: 'Not your comment' });
	}

	try {
		const parsed = CommentUpdateByUrlRequestSchema.parse(await request.json());
		const { signed_mutation: _sm, ...data } = parsed;
		const result = await commentController.updateComment(commentId, data);
		return json({
			status: 'success',
			data: {
				...result,
				id: result.id.toString(),
				did: extractDid(result.id),
				local_id: extractLocalId(result.id),
				author_id: result.author_id.toString()
			}
		});
	} catch (err) {
		if (err instanceof z.ZodError)
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid data',
				details: z.treeifyError(err)
			});
		if (err && typeof err === 'object' && 'status' in err) throw err;
		throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update comment' });
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	const user = await userRepository.findById(locals.user.id);
	if (!user) throw error(400, { code: 'BAD_REQUEST', message: 'Invalid User' });

	const commentId = recordIdFromDidAndLocal('comment', params.did, params.id);
	const existing = await commentController.getComment(commentId);
	if (!existing) throw error(404, { code: 'NOT_FOUND', message: 'Comment not found' });
	if (existing.author_id.toString() !== user.id.toString()) {
		throw error(403, { code: 'FORBIDDEN', message: 'Not your comment' });
	}

	await commentController.deleteComment(commentId);
	return json({ status: 'success', message: 'Comment deleted' });
};
