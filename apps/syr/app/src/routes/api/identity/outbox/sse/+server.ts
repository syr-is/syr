import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stringToRecordId } from '@syr-is/types';
import { outboxRepository } from '$lib/repositories/outbox.repository';

const POLL_INTERVAL_MS = 2000;

/**
 * GET /api/identity/outbox/sse
 * SSE stream for outbox job updates. Polls every 2s and sends current jobs.
 * Client should call invalidateAll() when receiving an event to refresh UI.
 */
export const GET: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const userId = stringToRecordId.decode(locals.user.id);

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			const send = (event: string, data: unknown) => {
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					// Client disconnected
				}
			};

			const poll = async () => {
				try {
					const jobs = await outboxRepository.findActiveByUserAndType(userId, 'registry_sync');
					send('outbox', {
						jobs: jobs.map((j) => ({
							id: String(j.id),
							type: j.type,
							status: j.status,
							attempts: j.attempts,
							maxAttempts: j.max_attempts,
							lastError: j.last_error,
							payload: j.payload,
							updatedAt: j.updated_at
						}))
					});
				} catch (err) {
					send('error', { message: err instanceof Error ? err.message : 'Unknown error' });
				}
			};

			// Initial poll
			await poll();

			// Poll periodically
			const interval = setInterval(poll, POLL_INTERVAL_MS);

			// Cleanup on client disconnect
			let closed = false;
			request.signal?.addEventListener('abort', () => {
				clearInterval(interval);
				if (!closed) {
					closed = true;
					try {
						controller.close();
					} catch {
						// Controller may already be closed (e.g. connection dropped)
					}
				}
			});
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive'
		}
	});
};
