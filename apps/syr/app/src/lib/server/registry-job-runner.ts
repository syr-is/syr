import { error } from '@sveltejs/kit';
import { registryRepository } from '$lib/repositories/registry.repository';
import { outboxRepository, type OutboxEntry } from '$lib/repositories/outbox.repository';

const REQUEST_TIMEOUT_MS = 5000;

export type RegistryJobPushParams = {
	job: OutboxEntry;
	action: 'update' | 'delete';
	did: string;
	registryUrl: string;
	/** From outbox job payload (authoritative for provider string sent to registry) */
	jobPayload: { provider?: string };
	providerForUpdate: string | undefined;
	updatedAt?: string;
	deletedAt?: string;
	signature: string;
	/** Root-signed directory row for `POST …/directory/upsert` (search / follow discovery). */
	directory?: {
		username: string;
		displayName: string;
		listed: boolean;
		updatedAt: string;
		signature: string;
	};
};

export type RegistryJobPushResult = { directorySyncOk: boolean };

/**
 * POST signed body to external publication registry, then update local DB and mark outbox complete.
 * On remote failure: marks job failed (may return to pending) and throws SvelteKit `error(502, ...)`.
 */
export async function pushSignedRegistryJobToRemoteAndComplete(
	params: RegistryJobPushParams
): Promise<RegistryJobPushResult> {
	const {
		job,
		action,
		did,
		registryUrl,
		jobPayload,
		providerForUpdate,
		updatedAt,
		deletedAt,
		signature,
		directory
	} = params;

	const base = registryUrl.replace(/\/$/, '');
	const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

	try {
		if (action === 'update') {
			if (!providerForUpdate || !updatedAt) {
				throw new Error('update requires provider and updatedAt');
			}
			const providerForRegistry = jobPayload.provider ?? providerForUpdate;
			const res = await fetch(`${base}/api/v1/update`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					did,
					provider: providerForRegistry,
					updatedAt,
					signature
				}),
				signal
			});
			if (!res.ok) {
				const body = await res.text();
				throw new Error(`Registry update failed (${res.status}): ${body}`);
			}
		} else {
			if (!deletedAt) {
				throw new Error('delete requires deletedAt');
			}
			const res = await fetch(`${base}/api/v1/delete`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ did, deletedAt, signature }),
				signal
			});
			if (!res.ok) {
				const body = await res.text();
				throw new Error(`Registry delete failed (${res.status}): ${body}`);
			}
		}
	} catch (err) {
		const msg =
			err instanceof Error && err.name === 'AbortError'
				? 'Registry request timed out'
				: err instanceof Error
					? err.message
					: 'Registry request failed';
		await outboxRepository.markFailed(job.id, msg, job.attempts + 1, job.max_attempts);
		throw error(502, { code: 'REGISTRY_ERROR', message: msg });
	}

	let directorySyncOk = true;
	if (directory) {
		const providerForRegistry = jobPayload.provider ?? providerForUpdate;
		if (!providerForRegistry) {
			directorySyncOk = false;
			console.error('[registry-job-runner] directory upsert skipped: missing provider');
		} else {
			try {
				const dirSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
				const res = await fetch(`${base}/api/v1/directory/upsert`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						did,
						provider: providerForRegistry,
						username: directory.username,
						displayName: directory.displayName,
						listed: directory.listed,
						updatedAt: directory.updatedAt,
						signature: directory.signature
					}),
					signal: dirSignal
				});
				if (!res.ok) {
					const body = await res.text();
					console.error('[registry-job-runner] directory upsert failed', res.status, body);
					directorySyncOk = false;
				}
			} catch (e) {
				console.error('[registry-job-runner] directory upsert error', e);
				directorySyncOk = false;
			}
		}
	}

	try {
		if (action === 'update') {
			await registryRepository.updateStatus(did, registryUrl, 'synced');
		} else {
			const registryEntry = await registryRepository.findByDidAndUrl(did, registryUrl);
			if (registryEntry) {
				await registryRepository.removeRegistry(registryEntry.id);
			}
		}
		await outboxRepository.markCompleted(job.id);
	} catch (dbErr) {
		// Remote registry already accepted the signed update; do not re-queue the same remote mutation.
		const msg = dbErr instanceof Error ? dbErr.message : 'Database update failed';
		try {
			await outboxRepository.markFinalizationFailed(job.id, msg, job.max_attempts);
		} catch (markErr) {
			console.error('[registry-job-runner] markFinalizationFailed threw:', markErr);
		}
	}

	return { directorySyncOk };
}
