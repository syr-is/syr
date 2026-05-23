import type { RecordId } from 'surrealdb';
import { BaseRepository } from './base.repository';
import { UserSchema, stringToRecordId, type User } from '@syr-is/types';

/**
 * User Repository
 * Handles CRUD operations for users
 */
export class UserRepository extends BaseRepository<User> {
	protected tableName = 'user';
	protected schema = UserSchema;

	/**
	 * Set the DID for a user (used when identity is created/imported).
	 */
	async updateDid(userId: RecordId, did: string): Promise<void> {
		await this.db.query('UPDATE $userId SET did = $did', { userId, did });
	}

	/**
	 * Unset the DID for a user (used on rollback when identity creation/import fails).
	 */
	async unsetDid(userId: RecordId): Promise<void> {
		await this.db.query('UPDATE $userId UNSET did', { userId });
	}

	/**
	 * Find user by username
	 */
	async findByUsername(username: string): Promise<User | null> {
		return this.findOne({ username } as Partial<User>);
	}

	/**
	 * Find user by DID
	 */
	async findByDid(did: string): Promise<User | null> {
		return this.findOne({ did } as Partial<User>);
	}

	/**
	 * Find all users with ADMIN role (for instance administrators contact info).
	 */
	async findAdmins(): Promise<Array<Pick<User, 'username' | 'did'>>> {
		const result = await this.db.query<[User[]]>(
			`SELECT username, did FROM ${this.tableName} WHERE role = 'ADMIN'`
		);
		const raw = result[0] ?? [];
		return raw.map((r) => ({
			username: r.username,
			did: r.did ?? null
		})) as Array<Pick<User, 'username' | 'did'>>;
	}

	/**
	 * Check if username exists
	 */
	async usernameExists(username: string): Promise<boolean> {
		const user = await this.findByUsername(username);
		return user !== null;
	}

	/**
	 * Find users with optional username/DID search, pagination, and sorting.
	 */
	async findManyWithSearch(options: {
		limit?: number;
		offset?: number;
		search?: string;
		sort?: { field: string; order: 'asc' | 'desc' };
	}): Promise<{ data: User[]; total: number }> {
		const { limit = 20, offset = 0, search, sort } = options;
		const params: Record<string, unknown> = { limit, offset };
		const conditions: string[] = [];

		if (search && search.trim()) {
			conditions.push('(username CONTAINS $search OR did CONTAINS $search)');
			params.search = search.trim();
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

		const ALLOWED_SORT_FIELDS: Record<string, string> = {
			created_at: 'created_at',
			updated_at: 'updated_at',
			username: 'username',
			role: 'role'
		};
		const orderField = ALLOWED_SORT_FIELDS[sort?.field ?? 'created_at'] ?? 'created_at';
		const orderDir = sort?.order === 'asc' ? 'ASC' : 'DESC';
		const orderClause = `ORDER BY ${orderField} ${orderDir}`;

		const [dataResult, countResult] = await Promise.all([
			this.db.query<[User[]]>(
				`SELECT * FROM ${this.tableName} ${whereClause} ${orderClause} LIMIT $limit START $offset`,
				params
			),
			this.db.query<[{ count: number }[]]>(
				`SELECT count() AS count FROM ${this.tableName} ${whereClause} GROUP ALL`,
				params
			)
		]);

		const data = (dataResult[0] ?? []).map((r) => this.validate(r));
		const total = countResult[0]?.[0]?.count ?? 0;
		return { data, total };
	}

	/**
	 * Count all users (cheap aggregate, no row fetch).
	 */
	async count(): Promise<number> {
		const result = await this.db.query<[{ total: number }[]]>(
			`SELECT count() AS total FROM ${this.tableName} GROUP ALL`
		);
		return result[0]?.[0]?.total ?? 0;
	}

	/**
	 * Map a set of user record-id strings to usernames in one query.
	 * Used to attach usernames to a page of results without fetching all users.
	 */
	async findUsernamesByIds(ids: string[]): Promise<Map<string, string>> {
		const map = new Map<string, string>();
		if (ids.length === 0) return map;
		const recordIds = ids.map((id) => stringToRecordId.decode(id));
		const result = await this.db.query<[{ id: RecordId; username: string }[]]>(
			`SELECT id, username FROM ${this.tableName} WHERE id IN $ids`,
			{ ids: recordIds }
		);
		for (const row of result[0] ?? []) {
			map.set(row.id.toString(), row.username);
		}
		return map;
	}

	/**
	 * Update username and set username_last_updated to now.
	 * Caller must validate cooldown and uniqueness.
	 */
	async updateUsername(userId: RecordId | string, newUsername: string): Promise<User | null> {
		const userRecordId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
		if (userRecordId.tb !== 'user') {
			throw new Error('Invalid user ID: record must target user collection');
		}
		const idVal = userRecordId.id;
		if (idVal === undefined || idVal === null || (typeof idVal === 'string' && !idVal.trim())) {
			throw new Error('Invalid user ID: record id must be defined and non-empty');
		}
		const now = new Date();
		const result = await this.db.merge(userRecordId, {
			username: newUsername,
			username_last_updated: now,
			updated_at: now
		});
		return result as User | null;
	}
}

// Export singleton instance
export const userRepository = new UserRepository();
