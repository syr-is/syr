import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { outboxRepository } from '$lib/repositories/outbox.repository';
import { stringToRecordId } from '@syr-is/types';

/**
 * GET /api/identity/pending-registry-jobs
 *
 * Returns pending registry_sync jobs for the authenticated user.
 * The client signs each job's payload and submits via POST /api/identity/registry-sign.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	const userId = stringToRecordId.decode(locals.user.id);
	const jobs = await outboxRepository.findActiveByUserAndType(userId, 'registry_sync');

	return json({
		status: 'success',
		data: {
			jobs: jobs.map((j) => ({
				id: String(j.id),
				action: (j.payload as { action?: string }).action,
				did: (j.payload as { did?: string }).did,
				registryUrl: (j.payload as { registryUrl?: string }).registryUrl,
				provider: (j.payload as { provider?: string }).provider,
				status: j.status,
				attempts: j.attempts,
				lastError: j.last_error
			}))
		},
		meta: { timestamp: new Date().toISOString() }
	});
};
