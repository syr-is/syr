import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordIdFromDidAndLocal } from '@syr-is/types';
import { emojiController } from '$lib/controllers/emoji.controller';
import { emojiRepository } from '$lib/repositories/emoji.repository';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	if (locals.user.role !== 'ADMIN') throw error(403, { code: 'FORBIDDEN', message: 'Admin only' });

	const emojiId = recordIdFromDidAndLocal('emoji', params.did, params.id);
	const emoji = await emojiRepository.findById(emojiId);
	if (!emoji) throw error(404, { code: 'NOT_FOUND', message: 'Emoji not found' });

	await emojiController.deleteEmoji(emojiId);
	return json({ status: 'success', message: 'Emoji deleted' });
};
