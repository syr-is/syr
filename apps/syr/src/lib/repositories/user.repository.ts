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

