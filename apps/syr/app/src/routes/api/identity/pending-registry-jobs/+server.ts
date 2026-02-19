import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { outboxRepository } from '$lib/repositories/outbox.repository';
import { stringToRecordId } from '@syr-is/types';

/** Strip stack traces and PII from error strings before returning to clients. */
function sanitizeError(err: string | Error | null | undefined): string | null {
	if (err == null || err === '') return null;
	const raw = typeof err === 'string' ? err : (err.message ?? String(err));
	// Remove stack traces (lines starting with "at " or containing file paths)
	const lines = raw.split('\n').filter((l) => !/^\s*at\s/.test(l) && !/\.(ts|js):\d+/.test(l));
	const first = lines[0]?.trim() ?? raw.slice(0, 200);
	return first.length > 200 ? first.slice(0, 200) + '…' : first;
}

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
			jobs: jobs.map((j) => {
				const payload = (j.payload ?? {}) as {
					action?: string;
					did?: string;
					registryUrl?: string;
					provider?: string;
				};
				return {
					id: String(j.id),
					action: payload.action,
					did: payload.did,
					registryUrl: payload.registryUrl,
					provider: payload.provider,
					status: j.status,
					attempts: j.attempts,
					lastError: sanitizeError(j.last_error)
				};
			})
		},
		meta: { timestamp: new Date().toISOString() }
	});
};
