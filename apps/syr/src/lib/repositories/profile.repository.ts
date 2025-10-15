import { BaseRepository } from './base.repository';
import {
	ProfileSchema,
	ProfileUpdateSchema,
	stringToRecordId,
	type Profile,
	type ProfileUpdate
} from '@syr-is/types';
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
	 * Merge profile by user ID
	 * Uses SurrealDB's merge method to update only specified fields
	 */
	async mergeByUserId(userId: RecordId | string, data: ProfileUpdate): Promise<Profile | null> {
		// First find the profile by user_id
		const profile = await this.findByUserId(userId);
		if (!profile) {
			return null;
		}

		const validatedData = ProfileUpdateSchema.safeParse(data);

		if (!validatedData.success) {
			throw new Error(`Validation failed: ${JSON.stringify(validatedData.error.issues)}`);
		}

		// Use SurrealDB's merge method to update only the specified fields using profile ID
		const result = await this.db.merge<Profile, ProfileUpdate>(profile.id, validatedData.data);

		return result as Profile | null;
	}
}

// Export singleton instance
export const profileRepository = new ProfileRepository();
