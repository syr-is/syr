import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { userRepository } from '$lib/repositories/user.repository';
import { emojiController } from '$lib/controllers/emoji.controller';
import { recordIdFromDidAndLocal } from '@syr-is/types';
import { emojiRepository } from '$lib/repositories/emoji.repository';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	const user = await userRepository.findById(locals.user.id);
	if (!user) throw error(400, { code: 'BAD_REQUEST', message: 'Invalid User' });

	const emojiId = recordIdFromDidAndLocal('emoji', params.did, params.id);
	const emoji = await emojiRepository.findById(emojiId);
	if (!emoji) throw error(404, { code: 'NOT_FOUND', message: 'Emoji not found' });
	if (emoji.author_id.toString() !== user.id.toString()) {
		throw error(403, { code: 'FORBIDDEN', message: 'Not your emoji' });
	}

	return json({
		status: 'success',
		data: { ...emoji, id: emoji.id.toString(), author_id: emoji.author_id.toString() }
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	const user = await userRepository.findById(locals.user.id);
	if (!user) throw error(400, { code: 'BAD_REQUEST', message: 'Invalid User' });

	const emojiId = recordIdFromDidAndLocal('emoji', params.did, params.id);
	const emoji = await emojiRepository.findById(emojiId);
	if (!emoji) throw error(404, { code: 'NOT_FOUND', message: 'Emoji not found' });
	if (emoji.author_id.toString() !== user.id.toString()) {
		throw error(403, { code: 'FORBIDDEN', message: 'Not your emoji' });
	}

	await emojiController.deleteEmoji(emojiId);
	return json({ status: 'success', message: 'Emoji deleted' });
};
