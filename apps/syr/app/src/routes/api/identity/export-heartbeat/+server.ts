import type { RequestHandler } from './$types';
import { subscribeExport } from '$lib/server/export-verify-broadcast';

const HEARTBEAT_INTERVAL_MS = 30_000; // keepalive for proxies/load balancers
const MAX_CONNECTION_LIFETIME_MS = 600_000; // 10 min — must outlive buildIdentityExport + chunked signing
const MAX_CONNECTIONS_PER_IP = 3;

const connectionsByIp = new Map<string, number>();

function getClientIp(request: Request): string {
	const forwarded = request.headers.get('x-forwarded-for');
	if (forwarded) {
		const first = forwarded.split(',')[0]?.trim();
		return first || 'unknown';
	}
	return 'unknown';
}

function tryAcquireConnection(ip: string): boolean {
	const count = connectionsByIp.get(ip) ?? 0;
	if (count >= MAX_CONNECTIONS_PER_IP) return false;
	connectionsByIp.set(ip, count + 1);
	return true;
}

function releaseConnection(ip: string): void {
	const count = connectionsByIp.get(ip) ?? 0;
	if (count <= 1) connectionsByIp.delete(ip);
	else connectionsByIp.set(ip, count - 1);
}

/**
 * GET /api/identity/export-heartbeat?challenge_id=xxx
 *
 * SSE stream — waits for export verification. Sends "verified" with export_token when Syner signs.
 */
export const GET: RequestHandler = async ({ request, url, getClientAddress }) => {
	const ip = getClientAddress?.() ?? getClientIp(request);
	if (!tryAcquireConnection(ip)) {
		return new Response('Too many SSE connections', { status: 429 });
	}

	const challengeId = url.searchParams.get('challenge_id');
	let intervalId: ReturnType<typeof setInterval> | undefined;
	let lifetimeTimeoutId: ReturnType<typeof setTimeout> | undefined;
	let unsubscribe: (() => void) | undefined;
	let cleaned = false;
	const controllerRef: { c?: ReadableStreamDefaultController<Uint8Array> } = {};

	function cleanup() {
		if (cleaned) return;
		cleaned = true;
		releaseConnection(ip);
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = undefined;
		}
		if (lifetimeTimeoutId) {
			clearTimeout(lifetimeTimeoutId);
			lifetimeTimeoutId = undefined;
		}
		unsubscribe?.();
		request.signal?.removeEventListener('abort', cleanup);
		try {
			controllerRef.c?.close();
		} catch {
			// Already closed
		}
	}

	const stream = new ReadableStream({
		start(c) {
			controllerRef.c = c as ReadableStreamDefaultController<Uint8Array>;
			const encoder = new TextEncoder();

			const send = (event: string, data: string) => {
				try {
					controllerRef.c?.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
				} catch {
					// Client disconnected
				}
			};

			intervalId = setInterval(() => send('heartbeat', String(Date.now())), HEARTBEAT_INTERVAL_MS);
			lifetimeTimeoutId = setTimeout(cleanup, MAX_CONNECTION_LIFETIME_MS);

			if (challengeId) {
				unsubscribe = subscribeExport(challengeId, (exportToken) => {
					send('verified', JSON.stringify({ export_token: exportToken }));
					cleanup();
				});
			}

			request.signal?.addEventListener('abort', cleanup);
		},
		cancel() {
			cleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
