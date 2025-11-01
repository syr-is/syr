import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sessionRepository } from '$lib/repositories/session.repository';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		return json(
			{ status: 'error', error: { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' } },
			{ status: 401 }
		);
	}

	const id = params.id;
	if (!id) {
		return json(
			{ status: 'error', error: { code: 'BAD_REQUEST', message: 'Missing id' } },
			{ status: 400 }
		);
	}

	if (id === locals.user.sessionId) {
		return json(
			{ status: 'error', error: { code: 'FORBIDDEN', message: 'Cannot delete current session' } },
			{ status: 403 }
		);
	}

	const session = await sessionRepository.findById(id);
	if (!session || session.user_id.toString() !== locals.user.id) {
		return json(
			{ status: 'error', error: { code: 'NOT_FOUND', message: 'Session not found' } },
			{ status: 404 }
		);
	}

	await sessionRepository.delete(id);

	return json({ status: 'success', data: { id } }, { status: 200 });
};
