import { BaseRepository } from './base.repository';
import {
	ProfileSchema,
	ProfileRepositoryMergeSchema,
	stringToRecordId,
	type Profile,
	type ProfileRepositoryMerge,
	type ProfileCreate
} from '@syr-is/types';
import type { RecordId } from 'surrealdb';
import { userRepository } from './user.repository';

/**
 * Profile Repository
 * Handles CRUD operations for user profiles
 */
export class ProfileRepository extends BaseRepository<Profile> {
	protected tableName = 'profile';
	protected schema = ProfileSchema;

	async createByUserId(
		userId: RecordId | string,
		overrides?: { display_name?: string; bio?: string }
	): Promise<Profile | null> {
		const userRecordId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
		const user = await userRepository.findById(userRecordId);
		if (!user) {
			throw new Error('User not found');
		}
		const result = await this.db.create<Profile, ProfileCreate>(this.tableName, {
			user_id: userRecordId,
			display_name: overrides?.display_name ?? user.username
		});
		const profile = result[0] as Profile | null;
		if (profile && overrides?.bio !== undefined) {
			return (await this.mergeByUserId(userRecordId, { bio: overrides.bio })) ?? profile;
		}
		return profile;
	}

	/**
	 * Create or get existing profile by user ID
	 * Handles race conditions by using upsert pattern
	 */
	async createOrGetByUserId(userId: RecordId | string): Promise<Profile | null> {
		const userRecordId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
		const user = await userRepository.findById(userRecordId);
		if (!user) {
			throw new Error('User not found');
		}

		try {
			// Try to create the profile
			const result = await this.db.create<Profile, ProfileCreate>(this.tableName, {
				user_id: userRecordId,
				display_name: user.username
			});
			return result[0] as Profile | null;
		} catch (error) {
			// If creation fails due to unique constraint violation, fetch existing profile
			if (this.isUniqueConstraintError(error)) {
				console.log(`Profile already exists for user ${userId}, fetching existing profile`);
				return await this.findByUserId(userId);
			}

			// Re-throw unexpected errors
			console.error('Unexpected error creating profile:', error);
			throw error;
		}
	}

	/**
	 * Check if error is a unique constraint violation
	 */
	private isUniqueConstraintError(error: unknown): boolean {
		// SurrealDB unique constraint error patterns
		if (error && typeof error === 'object' && 'message' in error) {
			const errorMessage = (error as { message: string }).message;
			return (
				errorMessage.includes('duplicate') ||
				errorMessage.includes('unique') ||
				errorMessage.includes('already exists')
			);
		}

		if (error && typeof error === 'object' && 'code' in error) {
			return (error as { code: string }).code === 'UNIQUE_CONSTRAINT_VIOLATION';
		}

		return false;
	}

	/**
	 * Batch-fetch profiles for multiple user IDs in a single query.
	 */
	async findByUserIds(userIds: RecordId[]): Promise<Profile[]> {
		if (userIds.length === 0) return [];
		const result = await this.db.query<[Profile[]]>(
			`SELECT * FROM ${this.tableName} WHERE user_id IN $userIds`,
			{ userIds }
		);
		return (result[0] ?? []).map((r) => {
			const transformed = this.transform(r);
			const parsed = this.schema.safeParse(transformed);
			return parsed.success ? parsed.data : (transformed as Profile);
		});
	}

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
	async mergeByUserId(
		userId: RecordId | string,
		data: ProfileRepositoryMerge
	): Promise<Profile | null> {
		// First find the profile by user_id
		const profile = await this.findByUserId(userId);
		if (!profile) {
			return null;
		}

		const validatedData = ProfileRepositoryMergeSchema.safeParse(data);

		if (!validatedData.success) {
			throw new Error(`Validation failed: ${JSON.stringify(validatedData.error.issues)}`);
		}

		// Use SurrealDB's merge method to update only the specified fields using profile ID
		const result = await this.db.merge<Profile, ProfileRepositoryMerge & { updated_at: Date }>(
			profile.id,
			{ ...validatedData.data, updated_at: new Date() }
		);

		return result as Profile | null;
	}

	/** Remove client-verification columns when the user saves without a signed envelope. */
	async clearSigningFieldsByUserId(userId: RecordId | string): Promise<void> {
		const userRecordId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
		const profile = await this.findByUserId(userRecordId);
		if (!profile) return;
		await this.db.query(
			`UPDATE $pid SET content_signature = NONE, signed_payload_json = NONE, signing_device_public_key = NONE`,
			{ pid: profile.id }
		);
	}
}

// Export singleton instance
export const profileRepository = new ProfileRepository();
