import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { reactionController } from '$lib/controllers/reaction.controller';
import { ReactionCreateRequestSchema, extractDid, extractLocalId } from '@syr-is/types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	}
	const user = await userRepository.findById(locals.user.id);
	if (!user) throw error(400, { code: 'BAD_REQUEST', message: 'Invalid User' });
	if (!user.did) {
		throw error(400, {
			code: 'IDENTITY_REQUIRED',
			message: 'You must create an identity before reacting'
		});
	}

	try {
		const body = await request.json();
		const parsed = ReactionCreateRequestSchema.parse(body);
		const { signed_mutation: _sm, ...reactionData } = parsed;

		const result = await reactionController.toggleReaction(user, reactionData);

		if (result.action === 'removed') {
			return json({ status: 'success', action: 'removed' });
		}

		return json(
			{
				status: 'success',
				action: 'created',
				data: result.reaction
					? {
							...result.reaction,
							id: result.reaction.id.toString(),
							did: extractDid(result.reaction.id),
							local_id: extractLocalId(result.reaction.id),
							author_id: result.reaction.author_id.toString()
						}
					: null
			},
			{ status: 201 }
		);
	} catch (err) {
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid reaction data',
				details: z.treeifyError(err)
			});
		}
		if (err && typeof err === 'object' && 'status' in err) throw err;
		throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to toggle reaction' });
	}
};
