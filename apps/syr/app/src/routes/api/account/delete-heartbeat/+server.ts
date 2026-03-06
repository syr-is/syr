import type { RequestHandler } from './$types';
import { subscribeDeleteAccount } from '$lib/server/export-verify-broadcast';
import { getDeleteAccountChallenge } from '$lib/server/export-verify-store';

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_CONNECTION_LIFETIME_MS = 120_000; // 2 min
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
 * GET /api/account/delete-heartbeat?challenge_id=xxx
 *
 * SSE stream — waits for delete-account verification. Sends "delete_account_verified" with delete_account_token when Syner signs.
 * Requires auth and challenge ownership.
 */
export const GET: RequestHandler = async ({ request, url, getClientAddress, locals }) => {
	if (!locals.user) {
		return new Response(JSON.stringify({ error: 'authentication_required' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const challengeId = url.searchParams.get('challenge_id');
	if (!challengeId?.trim()) {
		return new Response(JSON.stringify({ error: 'missing_challenge_id' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const challenge = await getDeleteAccountChallenge(challengeId);
	if (!challenge) {
		return new Response(JSON.stringify({ error: 'challenge_expired' }), {
			status: 410,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (challenge.user_id !== locals.user.id) {
		return new Response(JSON.stringify({ error: 'challenge_not_owned' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const ip = getClientAddress?.() ?? getClientIp(request);
	if (!tryAcquireConnection(ip)) {
		return new Response('Too many SSE connections', { status: 429 });
	}

	let keepaliveIntervalId: ReturnType<typeof setInterval> | undefined;
	let lifetimeTimeoutId: ReturnType<typeof setTimeout> | undefined;
	let unsubscribe: (() => void) | undefined;
	let cleaned = false;
	const controllerRef: { c?: ReadableStreamDefaultController<Uint8Array> } = {};

	function cleanup() {
		if (cleaned) return;
		cleaned = true;
		releaseConnection(ip);
		if (keepaliveIntervalId) {
			clearInterval(keepaliveIntervalId);
			keepaliveIntervalId = undefined;
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

			keepaliveIntervalId = setInterval(() => send('keepalive', '{}'), HEARTBEAT_INTERVAL_MS);
			lifetimeTimeoutId = setTimeout(cleanup, MAX_CONNECTION_LIFETIME_MS);

			unsubscribe = subscribeDeleteAccount(challengeId, (deleteAccountToken) => {
				send(
					'delete_account_verified',
					JSON.stringify({ delete_account_token: deleteAccountToken })
				);
				cleanup();
			});

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
