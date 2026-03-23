import type { SignedMutationEnvelope } from '@syr-is/types';

/**
 * Poll until Syner completes signing or timeout. Consumes the session on success (server deletes entry).
 */
export async function pollPostSignSessionResult(
	sessionId: string,
	opts?: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal }
): Promise<SignedMutationEnvelope> {
	const intervalMs = opts?.intervalMs ?? 1500;
	const timeoutMs = opts?.timeoutMs ?? 120_000;
	const signal = opts?.signal;
	const start = Date.now();

	for (;;) {
		if (signal?.aborted) {
			throw new DOMException('Polling aborted', 'AbortError');
		}
		if (Date.now() - start > timeoutMs) {
			throw new Error('Signing timed out. Return to Syner or try again.');
		}
		const res = await fetch(`/api/user/post-sign/${encodeURIComponent(sessionId)}/result`, {
			credentials: 'include'
		});
		if (res.status === 202) {
			await new Promise((r) => setTimeout(r, intervalMs));
			continue;
		}
		if (!res.ok) {
			const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
			throw new Error(j.error?.message ?? `HTTP ${res.status}`);
		}
		const json = (await res.json()) as {
			data?: { signed_mutation?: SignedMutationEnvelope };
		};
		const env = json.data?.signed_mutation;
		if (!env) {
			throw new Error('Invalid response from signing session');
		}
		return env;
	}
}
