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
	 * Regex to validate field names for safe interpolation into SurrealQL
	 * Only allows valid identifier names: starts with letter/underscore, followed by alphanumeric/underscore
	 */
	private static readonly VALID_FIELD_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

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
	 * Atomically get a KV entry's value and delete it.
	 * Prevents TOCTOU races where multiple callers could both read the same entry.
	 */
	async getAndDelete<T = unknown>(type: string, index: string): Promise<T | null> {
		const recordId = createKvRecordId(type, index);
		const result = await this.db.query<[KvEntry[]]>(`DELETE $recordId RETURN BEFORE`, { recordId });
		const records = result[0] ?? [];
		if (records.length === 0) return null;
		const entry = this.validate(records[0]);
		// Check expiry before returning
		if (entry.expires_at && entry.expires_at < new Date()) {
			return null;
		}
		return entry.value as T;
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
			`SELECT * FROM ${this.tableName} WHERE kv_type = $type AND (expires_at = NONE OR expires_at >= time::now())`,
			{ type }
		);

		const records = result[0] ?? [];
		return records.map((record: unknown) => this.validate(record));
	}

	/**
	 * Find KV entries by type and a nested field in value.
	 * Pushes the filter to the database to reduce network transfer; still requires scanning
	 * matching records (O(K) across records with kv_type, or O(N) if kv_type is unindexed).
	 * Proper indexing on kv_type or the nested field is required for indexed lookups.
	 * @param type - The category/type to query
	 * @param field - Field name within value object (validated for injection safety)
	 * @param fieldValue - Value to match
	 * @returns Matching entries (expired ones excluded)
	 */
	async findByTypeAndValueField(
		type: string,
		field: string,
		fieldValue: unknown
	): Promise<KvEntry[]> {
		if (!KvRepository.VALID_FIELD_REGEX.test(field)) {
			throw new Error(
				`Invalid field name: "${field}". Field names must start with a letter or underscore and contain only alphanumeric characters and underscores.`
			);
		}

		const result = await this.db.query<[KvEntry[]]>(
			`SELECT * FROM ${this.tableName} WHERE kv_type = $type AND value.${field} = $fieldValue AND (expires_at = NONE OR expires_at >= time::now())`,
			{ type, fieldValue }
		);

		const records = result[0] ?? [];
		return records.map((record: unknown) => this.validate(record));
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
		const data = rawData.map((record: unknown) => this.validate(record));
		const total = countResult[0]?.[0]?.total ?? 0;

		return { data, total };
	}

	/**
	 * Atomically increment a numeric field within the value object
	 * Uses SurrealDB's BEGIN...COMMIT transaction for atomic read-check-write
	 * @param type - The category/type of the entry
	 * @param index - The unique index within the type
	 * @param field - The field within the value object to increment (must be a valid identifier)
	 * @param amount - Amount to add (can be negative for decrement)
	 * @param minValue - Optional minimum value (will clamp to this)
	 * @param maxValue - Optional maximum value (will reject if exceeded)
	 * @param ttlSeconds - Optional time-to-live in seconds; sets expires_at for rate-limit-style windows
	 * @returns The new value of the field
	 * @throws Error if field name is invalid (potential injection)
	 * @throws Error with message 'QUOTA_EXCEEDED' if maxValue is specified and would be exceeded
	 * @throws Error if SurrealDB returns an unexpected response shape
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
		// Validate field name to prevent SurrealQL injection
		if (!KvRepository.VALID_FIELD_REGEX.test(field)) {
			throw new Error(
				`Invalid field name: "${field}". Field names must start with a letter or underscore and contain only alphanumeric characters and underscores.`
			);
		}

		if (ttlSeconds != null && ttlSeconds < 0) {
			throw new Error('ttlSeconds must be non-negative');
		}
		const recordId = createKvRecordId(type, index);
		const now = new Date();
		const expiresAt = ttlSeconds != null ? new Date(now.getTime() + ttlSeconds * 1000) : undefined;
		const expiresAtSet = expiresAt !== undefined ? ', expires_at = $expiresAt' : '';

		// Build a single atomic transaction query using BEGIN...COMMIT
		// This ensures the SELECT, check, and UPSERT happen atomically
		let query: string;

		if (maxValue !== undefined && minValue !== undefined) {
			// With both min and max constraints
			// Use THROW to signal quota exceeded - caught in error handler below
			// Note: SurrealDB math::min/max take arrays
			query = `
				BEGIN TRANSACTION;
				LET $record = SELECT * FROM ONLY $recordId;
				LET $current = IF $record != NONE AND ($record.expires_at IS NONE OR $record.expires_at > $now) { $record.value.${field} ?? 0 } ELSE { 0 };
				LET $proposed = $current + $amount;
				LET $clamped = math::max([<int> $minValue, <int> math::min([<int> $maxValue, <int> $proposed])]);
				IF $proposed > $maxValue {
					THROW "QUOTA_EXCEEDED";
				};
				UPSERT $recordId SET
					kv_type = $type,
					value.${field} = $clamped,
					created_at = created_at ?? $now,
					updated_at = $now${expiresAtSet};
				COMMIT TRANSACTION;
				RETURN $clamped;
			`;
		} else if (maxValue !== undefined) {
			// With max constraint only
			// Use THROW to signal quota exceeded - caught in error handler below
			query = `
				BEGIN TRANSACTION;
				LET $record = SELECT * FROM ONLY $recordId;
				LET $current = IF $record != NONE AND ($record.expires_at IS NONE OR $record.expires_at > $now) { $record.value.${field} ?? 0 } ELSE { 0 };
				LET $proposed = $current + $amount;
				IF $proposed > $maxValue {
					THROW "QUOTA_EXCEEDED";
				};
				UPSERT $recordId SET
					kv_type = $type,
					value.${field} = $proposed,
					created_at = created_at ?? $now,
					updated_at = $now${expiresAtSet};
				COMMIT TRANSACTION;
				RETURN $proposed;
			`;
		} else if (minValue !== undefined) {
			// With min constraint only - use transaction for atomic create-or-update
			// Note: SurrealDB math::max takes an array
			query = `
				BEGIN TRANSACTION;
				LET $record = SELECT * FROM ONLY $recordId;
				LET $current = IF $record != NONE AND ($record.expires_at IS NONE OR $record.expires_at > $now) { $record.value.${field} ?? 0 } ELSE { 0 };
				LET $newVal = math::max([<int> $minValue, <int> ($current + $amount)]);
				UPSERT $recordId SET
					kv_type = $type,
					value.${field} = $newVal,
					created_at = created_at ?? $now,
					updated_at = $now${expiresAtSet};
				COMMIT TRANSACTION;
				RETURN $newVal;
			`;
		} else {
			// No constraints - simple transaction with UPSERT
			query = `
				BEGIN TRANSACTION;
				LET $record = SELECT * FROM ONLY $recordId;
				LET $current = IF $record != NONE AND ($record.expires_at IS NONE OR $record.expires_at > $now) { $record.value.${field} ?? 0 } ELSE { 0 };
				LET $newVal = $current + $amount;
				UPSERT $recordId SET
					kv_type = $type,
					value.${field} = $newVal,
					created_at = created_at ?? $now,
					updated_at = $now${expiresAtSet};
				COMMIT TRANSACTION;
				RETURN $newVal;
			`;
		}

		try {
			const params: Record<string, unknown> = {
				recordId,
				type,
				amount,
				minValue: minValue ?? 0,
				maxValue: maxValue ?? Number.MAX_SAFE_INTEGER,
				now
			};
			if (expiresAt !== undefined) {
				params.expiresAt = expiresAt;
			}

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

			if (returnValue !== undefined) {
				return returnValue;
			}

			// Don't silently mask unexpected responses - throw with context for debugging
			throw new Error(
				`atomicIncrementField: unexpected SurrealDB response shape. ` +
					`recordId=${recordId.toString()}, field=${field}, amount=${amount}, ` +
					`result=${JSON.stringify(result)}`
			);
		} catch (err) {
			// Check if SurrealDB threw QUOTA_EXCEEDED
			const errMessage = err instanceof Error ? err.message : String(err);
			if (errMessage.includes('QUOTA_EXCEEDED')) {
				throw new Error('QUOTA_EXCEEDED');
			}
			throw err;
		}
	}

	/**
	 * Create a KV entry only if it doesn't already exist
	 * Uses a single INSERT attempt and catches duplicate-id errors for atomicity
	 * @param type - The category/type of the entry
	 * @param index - The unique index within the type
	 * @param value - The value to store
	 * @returns true if created, false if already existed (duplicate id)
	 */
	async createIfAbsent(type: string, index: string, value: unknown): Promise<boolean> {
		const recordId = createKvRecordId(type, index);
		const now = new Date();

		// Attempt INSERT directly - SurrealDB will error if the record already exists
		// This is atomic: no race condition between check and insert
		const query = `
			INSERT INTO kv {
				id: $recordId,
				kv_type: $type,
				value: $value,
				created_at: $now,
				updated_at: $now
			};
		`;

		try {
			await this.db.query(query, {
				recordId,
				type,
				value,
				now
			});
			// INSERT succeeded - record was created
			return true;
		} catch (err) {
			// Check if this is a duplicate-id error (record already exists)
			const errMessage = err instanceof Error ? err.message : String(err);
			if (
				errMessage.includes('already exists') ||
				errMessage.includes('duplicate') ||
				errMessage.includes('Database record')
			) {
				// Record already existed - this is expected, return false
				return false;
			}
			// Some other error - rethrow
			throw err;
		}
	}
}

// Export singleton instance
export const kvRepository = new KvRepository();
