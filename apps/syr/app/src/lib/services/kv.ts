import { kvRepository, KvRepository } from '$lib/repositories/kv.repository';
import type { KvEntry } from '@syr-is/types';

/**
 * KV Service
 * Provides high-level key-value storage operations
 * Uses SurrealDB for persistence with format kv:type:index
 */
export class KvService {
	constructor(private repository: KvRepository = kvRepository) {}

	/**
	 * Set a value in the KV store
	 * @param type - The category/type of the entry (e.g., 'session', 'cache')
	 * @param index - The unique index within the type
	 * @param value - Any JSON-serializable value
	 * @param ttlSeconds - Optional time-to-live in seconds
	 */
	async set<T = unknown>(
		type: string,
		index: string,
		value: T,
		ttlSeconds?: number
	): Promise<KvEntry> {
		return this.repository.set(type, index, value, ttlSeconds);
	}

	/**
	 * Get a value from the KV store
	 * @param type - The category/type of the entry
	 * @param index - The unique index within the type
	 * @returns The stored value or null if not found/expired
	 */
	async get<T = unknown>(type: string, index: string): Promise<T | null> {
		return this.repository.getValue<T>(type, index);
	}

	/**
	 * Get the full KV entry (including metadata)
	 * @param type - The category/type of the entry
	 * @param index - The unique index within the type
	 * @returns The full KV entry or null if not found/expired
	 */
	async getEntry(type: string, index: string): Promise<KvEntry | null> {
		return this.repository.get(type, index);
	}

	/**
	 * Delete a value from the KV store
	 * @param type - The category/type of the entry
	 * @param index - The unique index within the type
	 */
	async delete(type: string, index: string): Promise<void> {
		return this.repository.delete(type, index);
	}

	/**
	 * Atomically get and delete a value. Prevents TOCTOU races.
	 * @param type - The category/type of the entry
	 * @param index - The unique index within the type
	 * @returns The value if it existed and was not expired, null otherwise
	 */
	async getAndDelete<T = unknown>(type: string, index: string): Promise<T | null> {
		return this.repository.getAndDelete<T>(type, index);
	}

	/**
	 * Check if a key exists in the KV store
	 * @param type - The category/type of the entry
	 * @param index - The unique index within the type
	 */
	async has(type: string, index: string): Promise<boolean> {
		return this.repository.exists(type, index);
	}

	/**
	 * Get all entries of a specific type
	 * @param type - The category/type to retrieve
	 */
	async getByType(type: string): Promise<KvEntry[]> {
		return this.repository.findByType(type);
	}

	/**
	 * Find entries by type and a nested field in the value.
	 * Uses database-level filtering for efficient lookup instead of in-memory scan.
	 * @param type - The category/type to query
	 * @param field - Field name within the value object
	 * @param fieldValue - Value to match
	 * @throws Error when field does not match VALID_FIELD_REGEX (invalid identifier)
	 */
	async findByTypeAndValueField(
		type: string,
		field: string,
		fieldValue: unknown
	): Promise<KvEntry[]> {
		return this.repository.findByTypeAndValueField(type, field, fieldValue);
	}

	/**
	 * Delete all entries of a specific type
	 * @param type - The category/type to delete
	 */
	async deleteByType(type: string): Promise<void> {
		return this.repository.deleteByType(type);
	}

	/**
	 * Get or set a value (cache pattern)
	 * If the key exists, returns the cached value
	 * If not, calls the factory function, stores the result, and returns it
	 * @param type - The category/type of the entry
	 * @param index - The unique index within the type
	 * @param factory - Function to generate the value if not cached
	 * @param ttlSeconds - Optional time-to-live in seconds
	 */
	async getOrSet<T = unknown>(
		type: string,
		index: string,
		factory: () => T | Promise<T>,
		ttlSeconds?: number
	): Promise<T> {
		const existing = await this.get<T>(type, index);
		if (existing !== null) {
			return existing;
		}

		const value = await factory();
		await this.set(type, index, value, ttlSeconds);
		return value;
	}

	/**
	 * Update an existing value
	 * @param type - The category/type of the entry
	 * @param index - The unique index within the type
	 * @param updater - Function that receives the current value and returns the new value
	 * @param ttlSeconds - Optional new time-to-live in seconds
	 * @returns The updated entry or null if the key doesn't exist
	 */
	async update<T = unknown>(
		type: string,
		index: string,
		updater: (current: T) => T | Promise<T>,
		ttlSeconds?: number
	): Promise<KvEntry | null> {
		const current = await this.get<T>(type, index);
		if (current === null) {
			return null;
		}

		const newValue = await updater(current);
		return this.set(type, index, newValue, ttlSeconds);
	}

	/**
	 * Increment a numeric value
	 * @param type - The category/type of the entry
	 * @param index - The unique index within the type
	 * @param amount - Amount to increment (default: 1)
	 * @param ttlSeconds - Optional time-to-live in seconds
	 * @returns The new value
	 * @deprecated Use atomicIncrementField for race-condition-safe increments
	 */
	async increment(type: string, index: string, amount = 1, ttlSeconds?: number): Promise<number> {
		const current = await this.get<number>(type, index);
		const newValue = (current ?? 0) + amount;
		await this.set(type, index, newValue, ttlSeconds);
		return newValue;
	}

	/**
	 * Decrement a numeric value
	 * @param type - The category/type of the entry
	 * @param index - The unique index within the type
	 * @param amount - Amount to decrement (default: 1)
	 * @param ttlSeconds - Optional time-to-live in seconds
	 * @returns The new value
	 * @deprecated Use atomicIncrementField for race-condition-safe decrements
	 */
	async decrement(type: string, index: string, amount = 1, ttlSeconds?: number): Promise<number> {
		return this.increment(type, index, -amount, ttlSeconds);
	}

	/**
	 * Atomically increment a numeric field within the value object
	 * Uses database-level atomic operations to prevent race conditions
	 * @param type - The category/type of the entry
	 * @param index - The unique index within the type
	 * @param field - The field within the value object to increment
	 * @param amount - Amount to add (can be negative for decrement)
	 * @param minValue - Optional minimum value (will clamp to this)
	 * @param maxValue - Optional maximum value (will reject if exceeded)
	 * @param ttlSeconds - Optional time-to-live in seconds for rate-limit-style windows
	 * @returns The new value of the field
	 * @throws Error with message 'QUOTA_EXCEEDED' if maxValue is specified and would be exceeded
	 */
	async atomicIncrementField(
		type: string,
		index: string,
		field: string,
		amount: number,
		minValue?: number,
		maxValue?: number,
		ttlSeconds?: number
	): Promise<number> {
		return this.repository.atomicIncrementField(
			type,
			index,
			field,
			amount,
			minValue,
			maxValue,
			ttlSeconds
		);
	}

	/**
	 * Conditionally update a KV entry's value only if value.version matches.
	 * Used for optimistic locking. Returns true if update succeeded.
	 */
	async updateValueIfVersionMatch<T extends { version: number }>(
		type: string,
		index: string,
		expectedVersion: number,
		newValue: T,
		ttlSeconds?: number
	): Promise<boolean> {
		return this.repository.updateValueIfVersionMatch(
			type,
			index,
			expectedVersion,
			newValue,
			ttlSeconds
		);
	}

	/**
	 * Create a KV entry only if it doesn't already exist
	 * Uses database-level atomic operation to prevent race conditions
	 * @param type - The category/type of the entry
	 * @param index - The unique index within the type
	 * @param value - The value to store
	 * @returns true if created, false if already existed
	 */
	async createIfAbsent<T = unknown>(type: string, index: string, value: T): Promise<boolean> {
		return this.repository.createIfAbsent(type, index, value);
	}

	/**
	 * Set multiple values at once
	 * @param type - The category/type for all entries
	 * @param entries - Map of index -> value
	 * @param ttlSeconds - Optional time-to-live in seconds (applies to all)
	 */
	async setMany<T = unknown>(
		type: string,
		entries: Record<string, T>,
		ttlSeconds?: number
	): Promise<KvEntry[]> {
		const results: KvEntry[] = [];
		for (const [index, value] of Object.entries(entries)) {
			const entry = await this.set(type, index, value, ttlSeconds);
			results.push(entry);
		}
		return results;
	}

	/**
	 * Get multiple values at once
	 * @param type - The category/type for all entries
	 * @param indices - Array of indices to retrieve
	 * @returns Map of index -> value (missing keys will have null values)
	 */
	async getMany<T = unknown>(type: string, indices: string[]): Promise<Record<string, T | null>> {
		const results: Record<string, T | null> = {};
		for (const index of indices) {
			results[index] = await this.get<T>(type, index);
		}
		return results;
	}

	/**
	 * Clean up expired entries
	 * @returns Number of entries removed
	 */
	async cleanup(): Promise<number> {
		return this.repository.cleanupExpired();
	}

	/**
	 * Get all entries with pagination
	 * @param limit - Maximum number of entries to return
	 * @param offset - Number of entries to skip
	 */
	async list(limit = 100, offset = 0): Promise<{ data: KvEntry[]; total: number }> {
		return this.repository.findAll(limit, offset);
	}
}

// Export singleton instance
export const kvService = new KvService();
