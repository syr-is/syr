import { outboxRepository, type OutboxEntry } from '$lib/repositories/outbox.repository';

/**
 * Abstract outbox service with generic payload type.
 *
 * Subclasses define:
 * - `jobType` — the outbox job type string they handle
 * - `processJob()` — the actual work to perform for each job
 *
 * The base class handles:
 * - Polling loop with configurable interval
 * - Capped exponential backoff on failure
 * - Job lifecycle (processing → completed/failed)
 * - Start/stop lifecycle
 *
 * Usage:
 * ```ts
 * class RegistryOutboxService extends OutboxService<RegistryPayload> {
 *   jobType = 'registry_update';
 *   async processJob(payload: RegistryPayload): Promise<void> { ... }
 * }
 * ```
 */
export abstract class OutboxService<TPayload extends Record<string, unknown>> {
	/** The job type this service handles. */
	abstract readonly jobType: string;

	private intervalId: ReturnType<typeof setInterval> | null = null;
	private running = false;

	/** How often to poll for pending jobs (ms). Default: 10s */
	protected pollIntervalMs = 10_000;

	/** Max jobs to process per poll cycle. */
	protected batchSize = 10;

	/**
	 * Process a single job. Implementations perform the actual external call here.
	 * Throw an error to trigger retry with backoff.
	 */
	protected abstract processJob(payload: TPayload, entry: OutboxEntry): Promise<void>;

	/**
	 * Start the polling loop.
	 */
	start(): void {
		if (this.running) return;
		this.running = true;

		console.log(`📤 Outbox [${this.jobType}] processor started (poll: ${this.pollIntervalMs}ms)`);

		// Run immediately, then on interval
		this.poll();
		this.intervalId = setInterval(() => this.poll(), this.pollIntervalMs);
	}

	/**
	 * Stop the polling loop.
	 */
	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		this.running = false;
		console.log(`📤 Outbox [${this.jobType}] processor stopped`);
	}

	/**
	 * Poll for pending jobs and process them.
	 */
	private async poll(): Promise<void> {
		try {
			const pending = await outboxRepository.findPendingByType(this.jobType, this.batchSize);
			for (const entry of pending) {
				await this.executeJob(entry);
			}
		} catch (err) {
			console.error(`Outbox [${this.jobType}] poll error:`, err);
		}
	}

	/**
	 * Execute a single job with error handling.
	 */
	private async executeJob(entry: OutboxEntry): Promise<void> {
		try {
			await outboxRepository.markProcessing(entry.id);
			await this.processJob(entry.payload as TPayload, entry);
			await outboxRepository.markCompleted(entry.id);
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			const newAttempts = entry.attempts + 1;

			console.warn(
				`Outbox [${this.jobType}] job ${String(entry.id)} failed (attempt ${newAttempts}/${entry.max_attempts}): ${errorMessage}`
			);

			await outboxRepository.markFailed(entry.id, errorMessage, newAttempts, entry.max_attempts);
		}
	}
}
