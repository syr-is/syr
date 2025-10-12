import { BaseRepository } from './base.repository';
import { ProfileSchema, type Profile } from '@syr-is/types';
import type { RecordId } from 'surrealdb';

/**
 * Profile Repository
 * Handles CRUD operations for user profiles
 */
export class ProfileRepository extends BaseRepository<Profile> {
	protected tableName = 'profile';
	protected schema = ProfileSchema;

	/**
	 * Find profile by user ID
	 */
	async findByUserId(userId: RecordId | string): Promise<Profile | null> {
		// Query directly without type assertion - SurrealDB handles both RecordId and string
		const result = await this.db.query<[Profile[]]>(
			`SELECT * FROM ${this.tableName} WHERE user_id = $userId LIMIT 1`,
			{ userId }
		);
		return result[0]?.[0] ?? null;
	}

	/**
	 * Update profile by user ID
	 */
	async updateByUserId(userId: RecordId | string, data: Partial<Profile>): Promise<Profile | null> {
		const profile = await this.findByUserId(userId);
		if (!profile) {
			return null;
		}
		return this.update(profile.id, data);
	}
}

// Export singleton instance
export const profileRepository = new ProfileRepository();
