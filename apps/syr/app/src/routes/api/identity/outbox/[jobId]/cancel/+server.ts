import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { outboxRepository } from '$lib/repositories/outbox.repository';
import { stringToRecordId } from '@syr-is/types';

/**
 * POST /api/identity/outbox/[jobId]/cancel
 * Cancel an outbox job.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const jobId = stringToRecordId.decode(`outbox:${params.jobId}`);
	const jobs = await outboxRepository.findByUser(stringToRecordId.decode(locals.user.id));

	const job = jobs.find((j) => String(j.id) === String(jobId));
	if (!job) throw error(404, 'Outbox job not found');

	if (job.status === 'completed' || job.status === 'cancelled') {
		throw error(400, `Job already ${job.status}`);
	}

	await outboxRepository.cancel(jobId);
	return json({ status: 'ok', message: 'Job cancelled.' });
};
