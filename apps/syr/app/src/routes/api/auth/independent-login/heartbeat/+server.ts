import type { RequestHandler } from './$types';

const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * GET /api/auth/independent-login/heartbeat
 *
 * SSE stream that sends a "heartbeat" event every 60 seconds.
 * Used by the login page to refresh the Syner challenge/QR before it expires.
 */
export const GET: RequestHandler = async ({ request }) => {
	let intervalId: ReturnType<typeof setInterval> | undefined;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			const sendHeartbeat = () => {
				try {
					controller.enqueue(encoder.encode(`event: heartbeat\ndata: ${Date.now()}\n\n`));
				} catch {
					// Client disconnected
				}
			};

			intervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

			request.signal?.addEventListener('abort', cleanup);

			function cleanup() {
				clearInterval(intervalId);
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
