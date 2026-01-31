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
	 * Uses SurrealDB's atomic update to prevent race conditions
	 * @param type - The category/type of the entry
	 * @param index - The unique index within the type
	 * @param field - The field within the value object to increment
	 * @param amount - Amount to add (can be negative for decrement)
	 * @param minValue - Optional minimum value (will clamp to this)
	 * @returns The new value of the field
	 */
	async atomicIncrementField(
		type: string,
		index: string,
		field: string,
		amount: number,
		minValue?: number
	): Promise<number> {
		const recordId = createKvRecordId(type, index);
		const now = new Date();

		// First check if the record exists
		const existing = await this.db.select(recordId);

		if (!existing) {
			// Create new record with initial value
			const initialValue = minValue !== undefined ? Math.max(minValue, amount) : amount;
			const data: Record<string, unknown> = {
				kv_type: type,
				value: { [field]: initialValue },
				created_at: now,
				updated_at: now
			};
			await this.db.create(recordId, data);
			return initialValue;
		}

		// Use atomic update with SurrealDB
		// The math::max ensures we don't go below minValue if specified
		let query: string;
		if (minValue !== undefined) {
			query = `UPDATE $recordId SET 
				value.${field} = math::max($minValue, (value.${field} OR 0) + $amount),
				updated_at = $now
			RETURN value.${field}`;
		} else {
			query = `UPDATE $recordId SET 
				value.${field} = (value.${field} OR 0) + $amount,
				updated_at = $now
			RETURN value.${field}`;
		}

		const result = await this.db.query<[Array<{ [key: string]: number }>]>(query, {
			recordId,
			amount,
			minValue: minValue ?? 0,
			now
		});

		// Extract the new value from the result
		const newValue = result[0]?.[0]?.[field];
		return typeof newValue === 'number' ? newValue : 0;
	}
}

// Export singleton instance
export const kvRepository = new KvRepository();
