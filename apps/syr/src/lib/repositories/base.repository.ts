import type { Surreal, RecordId } from 'surrealdb';
import { z } from 'zod';
import type { QueryOptions } from '@syr-is/types';
import { stringToRecordId } from '@syr-is/types';
import { dbService } from '$lib/services/db';

/**
 * Base Repository
 * Abstract class providing common CRUD operations for all repositories
 */
export abstract class BaseRepository<T> {
	protected abstract tableName: string;
	protected abstract schema: z.ZodType<T>;

	/**
	 * Get database instance lazily (only when needed, not at module load time)
	 */
	protected get db(): Surreal {
		return dbService.getDb();
	}

	/**
	 * Transform SurrealDB response to match schema expectations
	 * Converts ISO date strings to Date instances
	 */
	protected transform(data: unknown): unknown {
		if (data && typeof data === 'object' && !Array.isArray(data)) {
			const transformed = { ...data } as Record<string, unknown>;
			// Transform date fields (created_at, updated_at, etc.)
			for (const [key, value] of Object.entries(transformed)) {
				if (
					(key === 'created_at' || key === 'updated_at' || key.endsWith('_at')) &&
					typeof value === 'string'
				) {
					// Check if it's an ISO date string
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
	protected validate(data: unknown): T {
		const transformed = this.transform(data);
		const result = this.schema.safeParse(transformed);
		if (!result.success) {
			throw new Error(`Validation failed: ${JSON.stringify(result.error.issues)}`);
		}
		return result.data;
	}

	/**
	 * Create a new record
	 */
	async create(data: Partial<T>): Promise<T> {
		// Don't validate on create - SurrealDB will generate id and handle defaults
		const result = await this.db.create(this.tableName, data as Record<string, unknown>);
		// SurrealDB returns array for table creation, single object for record creation
		const record = Array.isArray(result) ? result[0] : result;
		// Validate the result from database
		return this.validate(record);
	}

	/**
	 * Find a record by ID
	 */
	async findById(id: RecordId | string): Promise<T | null> {
		const recordId = typeof id === 'string' ? stringToRecordId.decode(id) : id;
		const record = await this.db.select(recordId);
		if (!record) return null;
		return this.validate(record);
	}

	/**
	 * Find a single record by parameters
	 */
	async findOne(params: Partial<T>): Promise<T | null> {
		const conditions = Object.entries(params)
			.map(([key]) => `${key} = $${key}`)
			.join(' AND ');

		const result = await this.db.query<[T[]]>(
			`SELECT * FROM ${this.tableName} WHERE ${conditions} LIMIT 1`,
			params as Record<string, unknown>
		);

		const record = result[0]?.[0];
		if (!record) return null;
		return this.validate(record);
	}

	/**
	 * Find many records with query options
	 */
	async findMany(options: Partial<QueryOptions> = {}): Promise<{ data: T[]; total: number }> {
		const { limit = 20, offset = 0, sort, search, filters = {} } = options;

		// Build WHERE clause
		const conditions: string[] = [];
		const params: Record<string, unknown> = {};

		Object.entries(filters).forEach(([key, val]) => {
			conditions.push(`${key} = $${key}`);
			params[key] = val;
		});

		if (search) {
			// Add search logic if needed
			params.search = `%${search}%`;
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

		// Build ORDER BY clause
		const orderClause = sort ? `ORDER BY ${sort.field} ${sort.order.toUpperCase()}` : '';

		// Query with pagination
		const query = `
			SELECT * FROM ${this.tableName}
			${whereClause}
			${orderClause}
			LIMIT $limit
			START $offset
		`;

		const countQuery = `
			SELECT count() AS total FROM ${this.tableName}
			${whereClause}
			GROUP ALL
		`;

		const [dataResult, countResult] = await Promise.all([
			this.db.query<[T[]]>(query, { ...params, limit, offset }),
			this.db.query<[{ total: number }[]]>(countQuery, params)
		]);

		const rawData = dataResult[0] ?? [];
		const data = rawData.map((record) => this.validate(record));
		const total = countResult[0]?.[0]?.total ?? 0;

		return { data, total };
	}

	/**
	 * Update a record by ID (alias for merge)
	 */
	async update(id: RecordId | string, data: Partial<T>): Promise<T> {
		return this.merge(id, data);
	}

	/**
	 * Merge data into a record by ID
	 * Merges the provided data with the existing record
	 */
	async merge(id: RecordId | string, data: Partial<T>): Promise<T> {
		const recordId = typeof id === 'string' ? stringToRecordId.decode(id) : id;
		const record = await this.db.merge(recordId, data as Record<string, unknown>);
		return this.validate(record);
	}

	/**
	 * Update a record by first removing given keys then merging the rest.
	 * Use when switching record shape (e.g. post type): merge() does not remove fields
	 * when values are undefined, so stale fields must be explicitly removed.
	 *
	 * Uses SurrealQL UNSET + MERGE inside a transaction so the operation is atomic
	 * (no window where the record is partially updated). Unlike JSON Patch `remove`,
	 * SurrealQL UNSET safely ignores fields that don't exist on the record, so
	 * optional fields that were never set won't cause failures.
	 */
	async updateWithUnset(
		id: RecordId | string,
		data: Partial<T>,
		keysToUnset: string[]
	): Promise<T> {
		const recordId = typeof id === 'string' ? stringToRecordId.decode(id) : id;
		const dataRecord = data as Record<string, unknown>;
		const mergePayload: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(dataRecord)) {
			if (keysToUnset.includes(key) || value === undefined) continue;
			mergePayload[key] = value;
		}

		if (keysToUnset.length > 0) {
			// Validate field names to prevent injection (should only contain word chars)
			for (const key of keysToUnset) {
				if (!/^\w+$/.test(key)) {
					throw new Error(`Invalid field name for unset: ${key}`);
				}
			}

			// Atomic UNSET + MERGE inside a single transaction
			const unsetFields = keysToUnset.join(', ');
			const results = await this.db.query(
				`BEGIN TRANSACTION; UPDATE $id UNSET ${unsetFields}; UPDATE $id MERGE $merge; COMMIT TRANSACTION;`,
				{ id: recordId, merge: mergePayload }
			);

			// Extract the updated record from transaction results.
			// Result shape varies by SurrealDB version; scan backwards for the first
			// non-empty array entry (the last UPDATE's return value).
			let record: unknown = null;
			if (Array.isArray(results)) {
				for (let i = results.length - 1; i >= 0; i--) {
					const entry = results[i];
					if (Array.isArray(entry) && entry.length > 0) {
						record = entry[0];
						break;
					}
				}
			}

			// Fallback: fetch the record directly if we couldn't extract from results
			if (!record) {
				record = await this.db.select(recordId);
			}

			if (!record) {
				throw new Error(`Record not found after updateWithUnset: ${recordId}`);
			}

			return this.validate(record);
		}

		const record = await this.db.merge(recordId, mergePayload);
		return this.validate(record);
	}

	/**
	 * Merge data into all records in the table
	 * Updates all records with the provided data
	 */
	async mergeAll(data: Partial<T>): Promise<T[]> {
		const records = await this.db.merge(this.tableName, data as Record<string, unknown>);
		return Array.isArray(records) ? (records as T[]) : [records as T];
	}

	/**
	 * Delete a record by ID
	 */
	async delete(id: RecordId | string): Promise<void> {
		const recordId = typeof id === 'string' ? stringToRecordId.decode(id) : id;
		await this.db.delete(recordId);
	}

	/**
	 * Check if a record exists by ID
	 */
	async exists(id: RecordId | string): Promise<boolean> {
		const record = await this.findById(id);
		return record !== null;
	}
}
