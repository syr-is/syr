import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sessionRepository } from '$lib/repositories/session.repository';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'Unauthorized'
		});
	}

	const id = params.id;
	if (!id) {
		throw error(400, {
			code: 'BAD_REQUEST',
			message: 'Missing id'
		});
	}

	if (id === locals.user.sessionId) {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'Cannot delete current session'
		});
	}

	const session = await sessionRepository.findById(id);
	if (!session || session.user_id.toString() !== locals.user.id) {
		throw error(404, {
			code: 'NOT_FOUND',
			message: 'Session not found'
		});
	}

	await sessionRepository.delete(id);

	return json({ status: 'success', data: { id } }, { status: 200 });
};
