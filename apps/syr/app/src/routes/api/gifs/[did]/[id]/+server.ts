import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { userRepository } from '$lib/repositories/user.repository';
import { gifController } from '$lib/controllers/gif.controller';
import { recordIdFromDidAndLocal } from '@syr-is/types';
import { gifRepository } from '$lib/repositories/gif.repository';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	const user = await userRepository.findById(locals.user.id);
	if (!user) throw error(400, { code: 'BAD_REQUEST', message: 'Invalid User' });

	const gifId = recordIdFromDidAndLocal('gif', params.did, params.id);
	const gif = await gifRepository.findById(gifId);
	if (!gif) throw error(404, { code: 'NOT_FOUND', message: 'GIF not found' });
	if (gif.author_id.toString() !== user.id.toString()) {
		throw error(403, { code: 'FORBIDDEN', message: 'Not your GIF' });
	}

	return json({
		status: 'success',
		data: { ...gif, id: gif.id.toString(), author_id: gif.author_id.toString() }
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	const user = await userRepository.findById(locals.user.id);
	if (!user) throw error(400, { code: 'BAD_REQUEST', message: 'Invalid User' });

	const gifId = recordIdFromDidAndLocal('gif', params.did, params.id);
	const gif = await gifRepository.findById(gifId);
	if (!gif) throw error(404, { code: 'NOT_FOUND', message: 'GIF not found' });
	if (gif.author_id.toString() !== user.id.toString()) {
		throw error(403, { code: 'FORBIDDEN', message: 'Not your GIF' });
	}

	await gifController.deleteGif(gifId);
	return json({ status: 'success', message: 'GIF deleted' });
};
