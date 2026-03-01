import type { RequestHandler } from './$types';
import { subscribe } from '$lib/server/independent-login-broadcast';

const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * GET /api/auth/independent-login/heartbeat?challenge_id=xxx
 *
 * SSE stream for the login page showing the Syner QR:
 * - Sends "heartbeat" every 60s to refresh the challenge before expiry
 * - Sends "verified" when Syner completes sign-in, with callback_token so the page can complete login
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const challengeId = url.searchParams.get('challenge_id');
	let intervalId: ReturnType<typeof setInterval> | undefined;
	let unsubscribe: (() => void) | undefined;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			const send = (event: string, data: string) => {
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
				} catch {
					// Client disconnected
				}
			};

			const sendHeartbeat = () => send('heartbeat', String(Date.now()));

			intervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

			if (challengeId) {
				unsubscribe = subscribe(challengeId, (token) => {
					send('verified', JSON.stringify({ token }));
					cleanup();
				});
			}

			request.signal?.addEventListener('abort', cleanup);

			function cleanup() {
				if (intervalId) {
					clearInterval(intervalId);
					intervalId = undefined;
				}
				unsubscribe?.();
				request.signal?.removeEventListener('abort', cleanup);
				try {
					controller.close();
				} catch {
					// Already closed
				}
			}
		},
		cancel() {
			if (intervalId) clearInterval(intervalId);
			unsubscribe?.();
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
