/**
 * Poll until Syner completes registry signing or timeout.
 */
export async function pollRegistrySignSessionResult(
	sessionId: string,
	opts?: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal }
): Promise<void> {
	const intervalMs = opts?.intervalMs ?? 1500;
	const timeoutMs = opts?.timeoutMs ?? 120_000;
	const signal = opts?.signal;
	const start = Date.now();

	for (;;) {
		if (signal?.aborted) {
			throw new DOMException('Polling aborted', 'AbortError');
		}
		if (Date.now() - start > timeoutMs) {
			throw new Error('Registry signing timed out. Return to Syner or try again.');
		}
		const res = await fetch(`/api/user/registry-sign/${encodeURIComponent(sessionId)}/result`, {
			credentials: 'include'
		});
		if (res.status === 202) {
			await new Promise((r) => setTimeout(r, intervalMs));
			continue;
		}
		const json = (await res.json().catch(() => ({}))) as {
			status?: string;
			data?: { error?: string };
			error?: { message?: string };
		};
		if (!res.ok) {
			throw new Error(json.error?.message ?? `HTTP ${res.status}`);
		}
		if (json.status === 'failed') {
			const err = new Error(json.data?.error ?? 'Registry signing failed');
			await fetch(`/api/user/registry-sign/${encodeURIComponent(sessionId)}/result`, {
				method: 'DELETE',
				credentials: 'include'
			}).catch(() => {});
			throw err;
		}
		if (json.status === 'success') {
			await fetch(`/api/user/registry-sign/${encodeURIComponent(sessionId)}/result`, {
				method: 'DELETE',
				credentials: 'include'
			}).catch(() => {});
			return;
		}
		throw new Error('Invalid registry sign session response');
	}
}
