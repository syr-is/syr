import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordIdFromDidAndLocal } from '@syr-is/types';
import { gifController } from '$lib/controllers/gif.controller';
import { gifRepository } from '$lib/repositories/gif.repository';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	if (locals.user.role !== 'ADMIN') throw error(403, { code: 'FORBIDDEN', message: 'Admin only' });

	const gifId = recordIdFromDidAndLocal('gif', params.did, params.id);
	const gif = await gifRepository.findById(gifId);
	if (!gif) throw error(404, { code: 'NOT_FOUND', message: 'GIF not found' });

	await gifController.deleteGif(gifId);
	return json({ status: 'success', message: 'GIF deleted' });
};
