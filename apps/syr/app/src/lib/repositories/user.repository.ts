import type { RecordId } from 'surrealdb';
import { BaseRepository } from './base.repository';
import { UserSchema, type User } from '@syr-is/types';

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
	 * Check if username exists
	 */
	async usernameExists(username: string): Promise<boolean> {
		const user = await this.findByUsername(username);
		return user !== null;
	}
}

// Export singleton instance
export const userRepository = new UserRepository();
