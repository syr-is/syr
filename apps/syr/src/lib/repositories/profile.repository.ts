import { BaseRepository } from './base.repository';
import { ProfileSchema, stringToRecordId, type Profile } from '@syr-is/types';
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
		const userRecordId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
		const result = await this.db.query<[Profile[]]>(
			`SELECT * FROM ${this.tableName} WHERE user_id = $userRecordId LIMIT 1`,
			{ userRecordId }
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
