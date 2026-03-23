import { dbService } from '$lib/services/db';
import type { RecordId } from 'surrealdb';

export interface OutboxEntry {
	id: RecordId;
	type: string;
	payload: Record<string, unknown>;
	status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
	attempts: number;
	max_attempts: number;
	next_retry_at: string;
	last_error: string | null;
	user_id: RecordId;
	created_at: string;
	updated_at: string;
}

class OutboxRepository {
	private get db() {
		return dbService.getDb();
	}

	/**
	 * Enqueue a new outbox job.
	 */
	async enqueue(params: {
		type: string;
		payload: Record<string, unknown>;
		userId: RecordId;
		maxAttempts?: number;
	}): Promise<OutboxEntry> {
		const { type, payload, userId, maxAttempts = 10 } = params;
		const now = new Date();
		const result = await this.db.query<[OutboxEntry[]]>(
			`CREATE outbox SET
				type = $type,
				payload = $payload,
				status = "pending",
				attempts = 0,
				max_attempts = $maxAttempts,
				next_retry_at = $now,
				last_error = NONE,
				user_id = $userId,
				created_at = $now,
				updated_at = $now`,
			{ type, payload, maxAttempts, userId, now }
		);
		return result[0][0];
	}

	/**
	 * Find pending jobs ready for processing.
	 */
	async findPending(limit = 20): Promise<OutboxEntry[]> {
		const now = new Date();
		const result = await this.db.query<[OutboxEntry[]]>(
			`SELECT * FROM outbox
				WHERE status IN ["pending", "processing"]
				AND next_retry_at <= $now
				ORDER BY next_retry_at ASC
				LIMIT $limit`,
			{ now, limit }
		);
		return result[0] ?? [];
	}

	/**
	 * Find pending jobs of a specific type.
	 */
	async findPendingByType(type: string, limit = 20): Promise<OutboxEntry[]> {
		const now = new Date();
		const result = await this.db.query<[OutboxEntry[]]>(
			`SELECT * FROM outbox
				WHERE type = $type
				AND status IN ["pending", "processing"]
				AND next_retry_at <= $now
				ORDER BY next_retry_at ASC
				LIMIT $limit`,
			{ type, now, limit }
		);
		return result[0] ?? [];
	}

	/**
	 * Atomically claim a pending job (set status to processing). Returns true if claimed, false if already claimed or not found.
	 */
	async claimIfPending(id: RecordId, userId: RecordId): Promise<boolean> {
		const result = await this.db.query<[OutboxEntry[]]>(
			`UPDATE outbox SET status = "processing", updated_at = time::now()
				WHERE id = $id AND user_id = $userId AND status = "pending"
				RETURN AFTER`,
			{ id, userId }
		);
		const updated = result[0] ?? [];
		return updated.length > 0;
	}

	/**
	 * Mark a job as processing.
	 */
	async markProcessing(id: RecordId): Promise<void> {
		await this.db.query(`UPDATE $id SET status = "processing", updated_at = time::now()`, { id });
	}

	/**
	 * Mark a job as completed.
	 */
	async markCompleted(id: RecordId): Promise<void> {
		await this.db.query(`UPDATE $id SET status = "completed", updated_at = time::now()`, { id });
	}

	/**
	 * Terminal failure after remote registry already accepted the mutation but local DB finalization failed.
	 * Does not return the job to pending (unlike markFailed with room to retry).
	 */
	async markFinalizationFailed(id: RecordId, error: string, maxAttempts: number): Promise<void> {
		await this.db.query(
			`UPDATE $id SET
				status = "failed",
				attempts = $maxAttempts,
				last_error = $error,
				next_retry_at = time::now(),
				updated_at = time::now()`,
			{ id, maxAttempts, error }
		);
	}

	/**
	 * Mark a job as failed, increment attempts, and calculate next retry.
	 */
	async markFailed(
		id: RecordId,
		error: string,
		attempts: number,
		maxAttempts: number
	): Promise<void> {
		const isFinalFailure = attempts >= maxAttempts;
		const status = isFinalFailure ? 'failed' : 'pending';

		// Capped exponential backoff: min(5s * 2^attempts, 1 hour)
		const baseDelayMs = 5000;
		const maxDelayMs = 3600000; // 1 hour
		const delayMs = Math.min(baseDelayMs * Math.pow(2, attempts), maxDelayMs);
		const nextRetry = new Date(Date.now() + delayMs);

		await this.db.query(
			`UPDATE $id SET
				status = $status,
				attempts = $attempts,
				last_error = $error,
				next_retry_at = $nextRetry,
				updated_at = time::now()`,
			{ id, status, attempts, error, nextRetry }
		);
	}

	/**
	 * Cancel a job (user-initiated).
	 */
	async cancel(id: RecordId): Promise<void> {
		await this.db.query(`UPDATE $id SET status = "cancelled", updated_at = time::now()`, { id });
	}

	/**
	 * Retry a job immediately (user-initiated). Resets next_retry_at to now.
	 */
	async retry(id: RecordId): Promise<void> {
		await this.db.query(
			`UPDATE $id SET
				status = "pending",
				next_retry_at = time::now(),
				updated_at = time::now()`,
			{ id }
		);
	}

	/**
	 * Delete all outbox jobs for a user.
	 */
	async deleteByUserId(userId: RecordId): Promise<void> {
		await this.db.query(`DELETE FROM outbox WHERE user_id = $userId`, { userId });
	}

	/**
	 * Find all outbox jobs for a user.
	 */
	async findByUser(userId: RecordId): Promise<OutboxEntry[]> {
		const result = await this.db.query<[OutboxEntry[]]>(
			`SELECT * FROM outbox WHERE user_id = $userId ORDER BY created_at DESC`,
			{ userId }
		);
		return result[0] ?? [];
	}

	/**
	 * Find outbox jobs for a user by type, excluding completed/cancelled.
	 */
	async findActiveByUserAndType(userId: RecordId, type: string): Promise<OutboxEntry[]> {
		const result = await this.db.query<[OutboxEntry[]]>(
			`SELECT * FROM outbox
				WHERE user_id = $userId
				AND type = $type
				AND status NOT IN ["completed", "cancelled"]
				ORDER BY created_at DESC`,
			{ userId, type }
		);
		return result[0] ?? [];
	}

	/**
	 * Find a single active job by id and user. Returns null if not found or completed/cancelled.
	 * @param jobId - RecordId or string (e.g. "outbox:xxxx")
	 */
	async findActiveByIdAndUser(
		jobId: RecordId | string,
		userId: RecordId
	): Promise<OutboxEntry | null> {
		const isString = typeof jobId === 'string';
		const [query, params] = isString
			? [
					`SELECT * FROM outbox
				WHERE id = type::thing($jobId)
				AND user_id = $userId
				AND status NOT IN ["completed", "cancelled"]
				LIMIT 1`,
					{ jobId, userId }
				]
			: [
					`SELECT * FROM outbox
				WHERE id = $jobId
				AND user_id = $userId
				AND status NOT IN ["completed", "cancelled"]
				LIMIT 1`,
					{ jobId, userId }
				];
		const result = await this.db.query<[OutboxEntry[]]>(query, params);
		const entries = result[0] ?? [];
		return entries[0] ?? null;
	}

	/** Current row for id + user regardless of status (for guards after handler errors). */
	async findByIdForUser(jobId: RecordId | string, userId: RecordId): Promise<OutboxEntry | null> {
		const isString = typeof jobId === 'string';
		const [query, params] = isString
			? [
					`SELECT * FROM outbox
				WHERE id = type::thing($jobId)
				AND user_id = $userId
				LIMIT 1`,
					{ jobId, userId }
				]
			: [
					`SELECT * FROM outbox
				WHERE id = $jobId
				AND user_id = $userId
				LIMIT 1`,
					{ jobId, userId }
				];
		const result = await this.db.query<[OutboxEntry[]]>(query, params);
		const entries = result[0] ?? [];
		return entries[0] ?? null;
	}
}

export const outboxRepository = new OutboxRepository();
