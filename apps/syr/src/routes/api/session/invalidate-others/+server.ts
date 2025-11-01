import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sessionRepository } from '$lib/repositories/session.repository';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json(
			{ status: 'error', error: { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' } },
			{ status: 401 }
		);
	}

	const sessions = await sessionRepository.findByUserId(locals.user.id);
	const toDelete = sessions.filter((s) => s.id.toString() !== locals.user!.sessionId);
	for (const s of toDelete) {
		await sessionRepository.delete(s.id);
	}

	return json({ status: 'success', data: { deleted: toDelete.map((s) => s.id.toString()) } });
};
