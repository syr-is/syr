import { invalidateAll } from '$app/navigation';
import { toast } from 'svelte-sonner';
import { sign, canonicalize, encodeMultibase } from '@syr-is/crypto';

/**
 * Process all pending registry sync jobs by signing each with the provided seed
 * and submitting to the registry-sign API.
 */
export async function processPendingRegistryJobs(seed: Uint8Array): Promise<void> {
	const res = await fetch('/api/identity/pending-registry-jobs', { credentials: 'include' });
	if (!res.ok) return;

	const { data: jobData } = await res.json();
	const jobs = jobData?.jobs ?? [];

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
			} else {
				deletedAt = new Date().toISOString();
				canonicalPayload = canonicalize({ did: job.did, deletedAt });
			}

			const signatureBytes = await sign(canonicalPayload, seed);
			const signature = encodeMultibase(signatureBytes);

			const signRes = await fetch('/api/identity/registry-sign', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
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
				toast.success('Registry synced');
				await invalidateAll();
			}
		} catch (e) {
			console.error('Registry sign/submit failed:', e);
		}
	}
}
