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
	protected abstract schema: z.ZodSchema<T>;

	/**
	 * Get database instance lazily (only when needed, not at module load time)
	 */
	protected get db(): Surreal {
		return dbService.getDb();
	}

	/**
	 * Validate data against schema
	 */
	protected validate(data: unknown): T {
		const result = this.schema.safeParse(data);
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
		return (record as T) ?? null;
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

		return result[0]?.[0] ?? null;
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

		const data = dataResult[0] ?? [];
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
		return record as T;
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
