import { invalidateAll } from '$app/navigation';
import { toast } from 'svelte-sonner';
import { sign, encodeMultibase } from '@syr-is/crypto';

export type RegistryPrepJobRow = {
	jobId: string;
	action: string;
	did: string;
	registryUrl: string;
	provider?: string;
	updatedAt?: string;
	deletedAt?: string;
	signObject: Record<string, unknown>;
	canonicalPayload: string;
	directorySignObject: Record<string, unknown>;
	directoryCanonicalPayload: string;
};

/**
 * Fetch server-issued canonical strings for pending registry_sync jobs (GET /api/identity/registry-sign-prep).
 */
export async function fetchRegistrySignPrep(): Promise<RegistryPrepJobRow[]> {
	const res = await fetch('/api/identity/registry-sign-prep', { credentials: 'include' });
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		console.error('registry-sign-prep failed:', res.status, body);
		throw new Error(`Failed to load registry sign prep (${res.status})`);
	}
	const json = (await res.json()) as { data?: { jobs?: RegistryPrepJobRow[] } };
	return json.data?.jobs ?? [];
}

/**
 * Process all pending registry sync jobs: prep (server timestamps) → sign with root seed → POST registry-sign.
 */
export async function processPendingRegistryJobs(seed: Uint8Array): Promise<void> {
	let jobs: RegistryPrepJobRow[];
	try {
		jobs = await fetchRegistrySignPrep();
	} catch (err) {
		console.error('Registry sign prep:', err);
		toast.error(err instanceof Error ? err.message : 'Failed to load registry jobs');
		return;
	}

	let anySuccess = false;

	for (const row of jobs) {
		try {
			const signatureBytes = await sign(row.canonicalPayload, seed);
			const signature = encodeMultibase(signatureBytes);
			const directorySigBytes = await sign(row.directoryCanonicalPayload, seed);
			const directorySignature = encodeMultibase(directorySigBytes);

			const signRes = await fetch('/api/identity/registry-sign', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					jobId: row.jobId,
					action: row.action,
					did: row.did,
					registryUrl: row.registryUrl,
					provider: row.provider,
					updatedAt: row.updatedAt,
					deletedAt: row.deletedAt,
					signature,
					directorySignature
				})
			});

			const resJson = (await signRes.json().catch(() => ({}))) as {
				data?: { directory_synced?: boolean };
				error?: { message?: string };
			};
			if (signRes.ok) {
				anySuccess = true;
				if (resJson.data?.directory_synced === false) {
					toast.warning(
						'Registry synced, but the directory listing could not be updated. Try syncing again.'
					);
				}
			} else {
				const msg = resJson.error?.message ?? `HTTP ${signRes.status}`;
				console.error('Registry sign failed:', msg);
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

export type RegistrySignSessionStartResponse = {
	session_id: string;
	deeplink_url: string;
	expires_in_sec: number;
	requested_device_public_key: string;
};

/**
 * Start a Syner signing session for one pending registry job (must be pending in outbox).
 */
export async function startRegistrySynerSession(
	jobId: string
): Promise<RegistrySignSessionStartResponse> {
	const res = await fetch('/api/user/registry-sign-session', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ jobId })
	});
	const j = await res.json().catch(() => ({}));
	if (!res.ok) {
		const msg = (j as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
		throw new Error(msg);
	}
	const data = (j as { data?: RegistrySignSessionStartResponse }).data;
	if (!data?.session_id || !data.deeplink_url) {
		throw new Error('Invalid registry sign session response');
	}
	return data;
}
