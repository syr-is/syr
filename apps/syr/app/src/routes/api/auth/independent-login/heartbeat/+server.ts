import type { RequestHandler } from './$types';
import { subscribe } from '$lib/server/independent-login-broadcast';

const HEARTBEAT_INTERVAL_MS = 60_000;
const MAX_CONNECTION_LIFETIME_MS = 600_000; // 10 min
const MAX_CONNECTIONS_PER_IP = 3;

const connectionsByIp = new Map<string, number>();

function getClientIp(request: Request): string {
	const forwarded = request.headers.get('x-forwarded-for');
	if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown';
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
 * GET /api/auth/independent-login/heartbeat?challenge_id=xxx
 *
 * SSE stream for the login page showing the Syner QR:
 * - Sends "heartbeat" every 60s to refresh the challenge before expiry
 * - Sends "verified" when Syner completes sign-in, with callback_token so the page can complete login
 * - Max connection lifetime: 10 min; per-IP connection cap: 3
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

			const sendHeartbeat = () => send('heartbeat', String(Date.now()));

			intervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

			lifetimeTimeoutId = setTimeout(cleanup, MAX_CONNECTION_LIFETIME_MS);

			if (challengeId) {
				unsubscribe = subscribe(challengeId, (token) => {
					send('verified', JSON.stringify({ token }));
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
