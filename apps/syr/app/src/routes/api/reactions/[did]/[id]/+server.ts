import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { userRepository } from '$lib/repositories/user.repository';
import { reactionController } from '$lib/controllers/reaction.controller';
import { recordIdFromDidAndLocal } from '@syr-is/types';
import { reactionRepository } from '$lib/repositories/reaction.repository';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	const user = await userRepository.findById(locals.user.id);
	if (!user) throw error(400, { code: 'BAD_REQUEST', message: 'Invalid User' });

	const reactionId = recordIdFromDidAndLocal('reaction', params.did, params.id);
	const existing = await reactionRepository.findById(reactionId);
	if (!existing) throw error(404, { code: 'NOT_FOUND', message: 'Reaction not found' });
	if (existing.author_id.toString() !== user.id.toString()) {
		throw error(403, { code: 'FORBIDDEN', message: 'Not your reaction' });
	}

	await reactionController.deleteReaction(reactionId);
	return json({ status: 'success', message: 'Reaction deleted' });
};
