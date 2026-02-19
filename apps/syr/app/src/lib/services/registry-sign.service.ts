import { invalidateAll } from '$app/navigation';
import { toast } from 'svelte-sonner';
import { sign, canonicalize, encodeMultibase } from '@syr-is/crypto';

/**
 * Process all pending registry sync jobs by signing each with the provided seed
 * and submitting to the registry-sign API.
 */
export async function processPendingRegistryJobs(seed: Uint8Array): Promise<void> {
	let res: Response;
	try {
		res = await fetch('/api/identity/pending-registry-jobs', { credentials: 'include' });
	} catch (err) {
		console.error('Failed to fetch pending registry jobs:', err);
		toast.error('Network error loading registry jobs');
		return;
	}
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		console.error('Pending registry jobs failed:', res.status, body);
		toast.error(`Failed to load registry jobs (${res.status})`);
		return;
	}

	const { data: jobData } = await res.json();
	const jobs = jobData?.jobs ?? [];
	let anySuccess = false;

	for (const job of jobs) {
		try {
			let canonicalPayload: string;
			let updatedAt: string | undefined;
			let deletedAt: string | undefined;

			if (job.action === 'update') {
				updatedAt = new Date().toISOString();
				canonicalPayload = canonicalize({
					did: job.did,
					provider: job.provider,
					updatedAt
				});
			} else if (job.action === 'delete') {
				deletedAt = new Date().toISOString();
				canonicalPayload = canonicalize({ did: job.did, deletedAt });
			} else {
				console.warn('Unknown registry job action, skipping:', job.action);
				continue;
			}

			const signatureBytes = await sign(canonicalPayload, seed);
			const signature = encodeMultibase(signatureBytes);

			const signRes = await fetch('/api/identity/registry-sign', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					jobId: job.id,
					action: job.action,
					did: job.did,
					registryUrl: job.registryUrl,
					provider: job.provider,
					updatedAt,
					deletedAt,
					signature
				})
			});

			if (signRes.ok) {
				anySuccess = true;
			}
		} catch (e) {
			console.error('Registry sign/submit failed:', e);
		}
	}

	if (anySuccess) {
		toast.success('Registry synced');
		await invalidateAll();
	}
}
