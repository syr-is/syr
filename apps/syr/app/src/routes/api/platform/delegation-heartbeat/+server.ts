import type { RequestHandler } from './$types';
import { subscribeDelegation } from '$lib/server/platform-delegation-broadcast';
import { getPendingDelegation } from '$lib/server/platform-delegation-store';

const HEARTBEAT_INTERVAL_MS = 60_000;
const MAX_CONNECTION_LIFETIME_MS = 600_000;

/**
 * GET /api/platform/delegation-heartbeat?challenge_id=xxx
 *
 * SSE stream for the consent page showing the Syner QR for delegation signing.
 * Sends "signed" when Syner completes signing, with the signature data.
 * Requires authentication — only the user who owns the pending delegation can subscribe.
 */
export const GET: RequestHandler = async ({ request, url, locals }) => {
	if (!locals.user) {
		return new Response(JSON.stringify({ error: 'unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const challengeId = url.searchParams.get('challenge_id');
	if (!challengeId || !/^[A-Za-z0-9_-]{1,64}$/.test(challengeId)) {
		return new Response(JSON.stringify({ error: 'invalid_challenge_id' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Verify the pending delegation belongs to this user
	const reg = await getPendingDelegation(challengeId);
	if (reg && reg.user_id !== locals.user.id.toString()) {
		return new Response(JSON.stringify({ error: 'forbidden' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	let intervalId: ReturnType<typeof setInterval> | undefined;
	let lifetimeTimeoutId: ReturnType<typeof setTimeout> | undefined;
	let unsubscribe: (() => void) | undefined;
	let cleaned = false;
	const controllerRef: { c?: ReadableStreamDefaultController<Uint8Array> } = {};

	function cleanup() {
		if (cleaned) return;
		cleaned = true;
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
					cleanup();
				}
			};

			intervalId = setInterval(() => send('heartbeat', String(Date.now())), HEARTBEAT_INTERVAL_MS);
			lifetimeTimeoutId = setTimeout(cleanup, MAX_CONNECTION_LIFETIME_MS);

			if (challengeId) {
				unsubscribe = subscribeDelegation(challengeId, (data) => {
					send('signed', JSON.stringify(data));
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
