import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { outboxRepository } from '$lib/repositories/outbox.repository';
import { stringToRecordId } from '@syr-is/types';

/**
 * POST /api/identity/outbox/[jobId]/retry
 * Manually retry a failed or pending outbox job.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const jobId = stringToRecordId.decode(`outbox:${params.jobId}`);
	const jobs = await outboxRepository.findByUser(stringToRecordId.decode(locals.user.id));

	const job = jobs.find((j) => String(j.id) === String(jobId));
	if (!job) throw error(404, 'Outbox job not found');

	if (job.status === 'completed' || job.status === 'cancelled') {
		throw error(400, { message: `Cannot retry a ${job.status} job` });
	}

	if (job.status === 'finalization_failed') {
		throw error(400, {
			message:
				'This job cannot be retried: the registry already accepted the update but local finalization failed. Contact support or reconcile manually.'
		});
	}

	const retried = await outboxRepository.retry(jobId);
	if (!retried) {
		throw error(400, {
			message: 'Job could not be requeued (wrong status or missing row).'
		});
	}
	return json({ status: 'ok', message: 'Job queued for immediate retry.' });
};
