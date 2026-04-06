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
		const orderField = sort?.field ?? 'created_at';
		const orderDir = sort?.order ?? 'desc';
		const orderClause = `ORDER BY ${orderField} ${orderDir.toUpperCase()}`;

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
