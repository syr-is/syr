import { KvEntrySchema, type KvEntry, createKvRecordId } from '@syr-is/types';
import { dbService } from '$lib/services/db';

/**
 * KV Repository
 * Handles CRUD operations for key-value storage
 * Uses a custom approach due to composite ID format (kv:type:index)
 */
export class KvRepository {
	protected tableName = 'kv';
	protected schema = KvEntrySchema;

	/**
	 * Get database instance lazily
	 */
	protected get db() {
		return dbService.getDb();
	}

	/**
	 * Transform SurrealDB response to match schema expectations
	 */
	protected transform(data: unknown): unknown {
		if (data && typeof data === 'object' && !Array.isArray(data)) {
			const transformed = { ...data } as Record<string, unknown>;
			for (const [key, value] of Object.entries(transformed)) {
				if (
					(key === 'created_at' ||
						key === 'updated_at' ||
						key === 'expires_at' ||
						key.endsWith('_at')) &&
					typeof value === 'string'
				) {
					if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
						transformed[key] = new Date(value);
					}
				}
			}
			return transformed;
		}
		return data;
	}

	/**
	 * Validate data against schema
	 */
	protected validate(data: unknown): KvEntry {
		const transformed = this.transform(data);
		const result = this.schema.safeParse(transformed);
		if (!result.success) {
			throw new Error(`Validation failed: ${JSON.stringify(result.error.issues)}`);
		}
		return result.data;
	}

	/**
	 * Create or update a KV entry
	 * Uses upsert semantics - creates if not exists, updates if exists
	 */
	async set(type: string, index: string, value: unknown, ttlSeconds?: number): Promise<KvEntry> {
		const recordId = createKvRecordId(type, index);
		const now = new Date();
		const expiresAt = ttlSeconds ? new Date(now.getTime() + ttlSeconds * 1000) : undefined;

		const data: Record<string, unknown> = {
			kv_type: type,
			value,
			updated_at: now
		};

		if (expiresAt) {
			data.expires_at = expiresAt;
		}

		// Check if exists
		const existing = await this.db.select(recordId);

		if (existing) {
			// Update existing
			const result = await this.db.merge(recordId, data);
			return this.validate(result);
		} else {
			// Create new with specific ID
			data.created_at = now;
			const result = await this.db.create(recordId, data);
			const record = Array.isArray(result) ? result[0] : result;
			return this.validate(record);
		}
	}

	/**
	 * Get a KV entry by type and index
	 */
	async get(type: string, index: string): Promise<KvEntry | null> {
		const recordId = createKvRecordId(type, index);
		const record = await this.db.select(recordId);
		if (!record) return null;

		const entry = this.validate(record);

		// Check if expired
		if (entry.expires_at && entry.expires_at < new Date()) {
			// Expired, delete and return null
			await this.delete(type, index);
			return null;
		}

		return entry;
	}

	/**
	 * Get just the value from a KV entry
	 */
	async getValue<T = unknown>(type: string, index: string): Promise<T | null> {
		const entry = await this.get(type, index);
		return entry ? (entry.value as T) : null;
	}

	/**
	 * Delete a KV entry by type and index
	 */
	async delete(type: string, index: string): Promise<void> {
		const recordId = createKvRecordId(type, index);
		await this.db.delete(recordId);
	}

	/**
	 * Check if a KV entry exists
	 */
	async exists(type: string, index: string): Promise<boolean> {
		const entry = await this.get(type, index);
		return entry !== null;
	}

	/**
	 * Find all KV entries by type
	 */
	async findByType(type: string): Promise<KvEntry[]> {
		const result = await this.db.query<[KvEntry[]]>(
			`SELECT * FROM ${this.tableName} WHERE kv_type = $type`,
			{ type }
		);

		const records = result[0] ?? [];
		const now = new Date();

		// Filter out expired entries and validate
		const validEntries: KvEntry[] = [];
		for (const record of records) {
			const entry = this.validate(record);
			if (!entry.expires_at || entry.expires_at >= now) {
				validEntries.push(entry);
			}
		}

		return validEntries;
	}

	/**
	 * Delete all KV entries by type
	 */
	async deleteByType(type: string): Promise<void> {
		await this.db.query(`DELETE FROM ${this.tableName} WHERE kv_type = $type`, { type });
	}

	/**
	 * Clean up expired entries
	 * Should be called periodically to remove expired KV entries
	 */
	async cleanupExpired(): Promise<number> {
		const result = await this.db.query<[{ count: number }[]]>(
			`DELETE FROM ${this.tableName} WHERE expires_at != NONE AND expires_at < time::now() RETURN { count: count() }`
		);
		return result[0]?.[0]?.count ?? 0;
	}

	/**
	 * Get all entries (with optional pagination)
	 */
	async findAll(limit = 100, offset = 0): Promise<{ data: KvEntry[]; total: number }> {
		const [dataResult, countResult] = await Promise.all([
			this.db.query<[KvEntry[]]>(
				`SELECT * FROM ${this.tableName} WHERE expires_at = NONE OR expires_at >= time::now() LIMIT $limit START $offset`,
				{ limit, offset }
			),
			this.db.query<[{ total: number }[]]>(
				`SELECT count() AS total FROM ${this.tableName} WHERE expires_at = NONE OR expires_at >= time::now() GROUP ALL`
			)
		]);

		const rawData = dataResult[0] ?? [];
		const data = rawData.map((record) => this.validate(record));
		const total = countResult[0]?.[0]?.total ?? 0;

		return { data, total };
	}

	/**
	 * Atomically increment a numeric field within the value object
	 * Uses SurrealDB's UPSERT for atomic create-or-update to prevent race conditions
	 * @param type - The category/type of the entry
	 * @param index - The unique index within the type
	 * @param field - The field within the value object to increment
	 * @param amount - Amount to add (can be negative for decrement)
	 * @param minValue - Optional minimum value (will clamp to this)
	 * @param maxValue - Optional maximum value (will reject if exceeded)
	 * @returns The new value of the field
	 * @throws Error if maxValue is specified and increment would exceed it
	 */
	async atomicIncrementField(
		type: string,
		index: string,
		field: string,
		amount: number,
		minValue?: number,
		maxValue?: number
	): Promise<number> {
		const recordId = createKvRecordId(type, index);
		const now = new Date();

		// Build a single atomic UPSERT query that handles both create and update
		// This eliminates the race condition between select and create
		let query: string;

		if (maxValue !== undefined && minValue !== undefined) {
			// With both min and max constraints
			// Return -1 as sentinel value if quota would be exceeded
			// Note: SurrealDB math::min/max take arrays
			query = `
				LET $record = SELECT * FROM ONLY $recordId;
				LET $current = IF $record { $record.value.${field} ?? 0 } ELSE { 0 };
				LET $proposed = $current + $amount;
				LET $clamped = math::max([<int> $minValue, <int> math::min([<int> $maxValue, <int> $proposed])]);
				IF $proposed > $maxValue {
					RETURN -1;
				} ELSE {
					UPSERT $recordId SET
						kv_type = $type,
						value.${field} = $clamped,
						created_at = created_at ?? $now,
						updated_at = $now;
					RETURN $clamped;
				};
			`;
		} else if (maxValue !== undefined) {
			// With max constraint only
			// Return -1 as sentinel value if quota would be exceeded
			query = `
				LET $record = SELECT * FROM ONLY $recordId;
				LET $current = IF $record { $record.value.${field} ?? 0 } ELSE { 0 };
				LET $proposed = $current + $amount;
				IF $proposed > $maxValue {
					RETURN -1;
				} ELSE {
					UPSERT $recordId SET
						kv_type = $type,
						value.${field} = $proposed,
						created_at = created_at ?? $now,
						updated_at = $now;
					RETURN $proposed;
				};
			`;
		} else if (minValue !== undefined) {
			// With min constraint only - use UPSERT for atomic create-or-update
			// Note: SurrealDB math::max takes an array
			query = `
				LET $record = SELECT * FROM ONLY $recordId;
				LET $current = IF $record { $record.value.${field} ?? 0 } ELSE { 0 };
				LET $newVal = math::max([<int> $minValue, <int> ($current + $amount)]);
				UPSERT $recordId SET
					kv_type = $type,
					value.${field} = $newVal,
					created_at = created_at ?? $now,
					updated_at = $now;
				RETURN $newVal;
			`;
		} else {
			// No constraints - simple UPSERT
			query = `
				LET $record = SELECT * FROM ONLY $recordId;
				LET $current = IF $record { $record.value.${field} ?? 0 } ELSE { 0 };
				LET $newVal = $current + $amount;
				UPSERT $recordId SET
					kv_type = $type,
					value.${field} = $newVal,
					created_at = created_at ?? $now,
					updated_at = $now;
				RETURN $newVal;
			`;
		}

		try {
			const params = {
				recordId,
				type,
				amount,
				minValue: minValue ?? 0,
				maxValue: maxValue ?? Number.MAX_SAFE_INTEGER,
				now
			};

			const result = await this.db.query<[unknown]>(query, params);

			// Find the actual return value - it could be at different positions in the result array
			let returnValue: number | undefined;

			for (let i = result.length - 1; i >= 0; i--) {
				const item = result[i];
				if (typeof item === 'number') {
					returnValue = item;
					break;
				}
				if (Array.isArray(item) && item.length > 0) {
					const firstItem = item[0];
					if (typeof firstItem === 'number') {
						returnValue = firstItem;
						break;
					}
					if (typeof firstItem === 'object' && firstItem !== null && field in firstItem) {
						const val = (firstItem as Record<string, unknown>)[field];
						if (typeof val === 'number') {
							returnValue = val;
							break;
						}
					}
				}
			}

			// Check for sentinel value indicating quota exceeded
			if (returnValue === -1) {
				throw new Error('QUOTA_EXCEEDED');
			}

			if (returnValue !== undefined) {
				return returnValue;
			}

			return 0;
		} catch (err) {
			// Re-throw quota exceeded errors as-is
			if (err instanceof Error && err.message.includes('QUOTA_EXCEEDED')) {
				throw err;
			}
			throw err;
		}
	}

	/**
	 * Create a KV entry only if it doesn't already exist
	 * Uses SurrealDB's INSERT to atomically create-if-absent
	 * @param type - The category/type of the entry
	 * @param index - The unique index within the type
	 * @param value - The value to store
	 * @returns true if created, false if already existed
	 */
	async createIfAbsent(type: string, index: string, value: unknown): Promise<boolean> {
		const recordId = createKvRecordId(type, index);
		const now = new Date();

		// Use SELECT to check existence, then INSERT if not present
		const query = `
			LET $existing = SELECT * FROM ONLY $recordId;
			IF $existing == NONE THEN
				INSERT INTO kv {
					id: $recordId,
					kv_type: $type,
					value: $value,
					created_at: $now,
					updated_at: $now
				};
				RETURN true;
			ELSE
				RETURN false;
			END
		`;

		const result = await this.db.query<[boolean]>(query, {
			recordId,
			type,
			value,
			now
		});

		return result[0] === true;
	}
}

// Export singleton instance
export const kvRepository = new KvRepository();
