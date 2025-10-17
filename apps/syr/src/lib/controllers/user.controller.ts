import { profileRepository } from '$lib/repositories/profile.repository';
import type { ProfileUpdate, Profile } from '@syr-is/types';
import type { RecordId } from 'surrealdb';

export interface UpdateProfileResponse {
	profile: Profile;
}

/**
 * User Controller
 * Business logic for user-related operations
 */
export class UserController {
	/**
	 * Update user profile
	 * Uses SurrealDB's MERGE operation to update only specified fields
	 */
	async updateProfile(
		userId: RecordId | string,
		data: ProfileUpdate
	): Promise<UpdateProfileResponse> {
		// Get existing profile
		const existingProfile = await profileRepository.findByUserId(userId);

		if (!existingProfile) {
			throw new Error('Profile not found');
		}

		// Merge profile with new data using SurrealDB's MERGE operation
		const updatedProfile = await profileRepository.mergeByUserId(userId, data);

		if (!updatedProfile) {
			throw new Error('Failed to update profile');
		}

		return {
			profile: updatedProfile
		};
	}
}

// Export singleton instance
export const userController = new UserController();
