/**
 * Hardened fetch for cross-instance API calls.
 * Enforces timeout and response body size limits to prevent DoS from malicious instances.
 */

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export interface SafeFetchOptions {
	timeoutMs?: number;
	maxBytes?: number;
	signal?: AbortSignal;
	credentials?: RequestCredentials;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
}

/**
 * Fetch with timeout and streaming body size limit.
 * Returns a Response with the buffered body (callers can use .json() normally).
 * Throws on timeout, size exceeded, or network error.
 */
export async function safeRemoteFetch(url: string, opts?: SafeFetchOptions): Promise<Response> {
	const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;

	const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
	if (opts?.signal) signals.push(opts.signal);
	const combined = signals.length === 1 ? signals[0] : AbortSignal.any(signals);

	const res = await fetch(url, {
		signal: combined,
		credentials: opts?.credentials ?? 'omit',
		method: opts?.method,
		headers: opts?.headers,
		body: opts?.body
	});

	if (!res.ok) {
		throw new Error(`HTTP ${res.status}`);
	}

	// Stream body with size limit
	const reader = res.body?.getReader();
	if (!reader) return new Response(null, { status: res.status, headers: res.headers });

	const chunks: Uint8Array[] = [];
	let total = 0;

	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value?.byteLength) {
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel().catch(() => {});
				throw new Error(`Response exceeded ${maxBytes} bytes`);
			}
			chunks.push(value);
		}
	}

	const buf = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		buf.set(c, offset);
		offset += c.byteLength;
	}

	return new Response(buf, { status: res.status, headers: res.headers });
}

/**
 * Convenience: fetch JSON from a remote instance with timeout + size limit.
 * Returns parsed JSON or null on any failure.
 */
export async function safeRemoteJson<T = unknown>(
	url: string,
	opts?: SafeFetchOptions
): Promise<T | null> {
	try {
		const res = await safeRemoteFetch(url, {
			...opts,
			headers: { Accept: 'application/json', ...opts?.headers }
		});
		return (await res.json()) as T;
	} catch {
		return null;
	}
}
