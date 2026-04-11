import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { commentController } from '$lib/controllers/comment.controller';
import { CommentCreateRequestSchema, extractDid, extractLocalId } from '@syr-is/types';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	}
	const user = await userRepository.findById(locals.user.id);
	if (!user) throw error(400, { code: 'BAD_REQUEST', message: 'Invalid User' });

	const limit = Math.min(
		100,
		Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20)
	);
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);

	const { data, total } = await commentController.getUserComments(user.id, {
		limit,
		offset,
		sort: { field: 'created_at', order: 'desc' }
	});

	const serialized = data.map((c) => ({
		...c,
		id: c.id.toString(),
		did: extractDid(c.id),
		local_id: extractLocalId(c.id),
		author_id: c.author_id.toString(),
		created_at: c.created_at.toISOString(),
		updated_at: c.updated_at.toISOString()
	}));

	return json({
		status: 'success',
		data: serialized,
		pagination: { limit, offset, total, has_more: offset + data.length < total }
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	}
	const user = await userRepository.findById(locals.user.id);
	if (!user) throw error(400, { code: 'BAD_REQUEST', message: 'Invalid User' });
	if (!user.did) {
		throw error(400, {
			code: 'IDENTITY_REQUIRED',
			message: 'You must create an identity before commenting'
		});
	}

	try {
		const body = await request.json();
		const parsed = CommentCreateRequestSchema.parse(body);
		const { comment_local_id, signed_mutation: _sm, ...commentData } = parsed;

		const result = await commentController.createComment(user, commentData, {
			localId: comment_local_id
		});

		return json(
			{
				status: 'success',
				data: {
					...result,
					id: result.id.toString(),
					did: extractDid(result.id),
					local_id: extractLocalId(result.id),
					author_id: result.author_id.toString()
				}
			},
			{ status: 201 }
		);
	} catch (err) {
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid comment data',
				details: z.treeifyError(err)
			});
		}
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('Comment creation error:', err);
		throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create comment' });
	}
};
