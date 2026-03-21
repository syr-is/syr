import { profileRepository } from '$lib/repositories/profile.repository';
import { userRepository } from '$lib/repositories/user.repository';
import { getUsernameChangeCooldownDays } from '$lib/instance-config';
import type { ProfileRepositoryMerge, Profile, User } from '@syr-is/types';
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
		data: ProfileRepositoryMerge
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

	/**
	 * Update username with cooldown check.
	 * Cooldown days from instance config; null username_last_updated = allow first change.
	 */
	async updateUsername(userId: RecordId | string, newUsername: string): Promise<User> {
		const user = await userRepository.findById(userId);
		if (!user) throw new Error('User not found');

		if (newUsername === user.username) {
			throw new Error('Username unchanged');
		}

		const cooldownDays = await getUsernameChangeCooldownDays();
		const lastUpdated = user.username_last_updated;

		if (lastUpdated) {
			const msPerDay = 24 * 60 * 60 * 1000;
			const elapsedMs = Date.now() - lastUpdated.getTime();
			if (elapsedMs < cooldownDays * msPerDay) {
				const daysLeft = Math.ceil((cooldownDays * msPerDay - elapsedMs) / msPerDay);
				throw new Error(
					`You can change your username again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
				);
			}
		}

		const taken = await userRepository.usernameExists(newUsername);
		if (taken) throw new Error('Username is already taken');

		const updated = await userRepository.updateUsername(userId, newUsername);
		if (!updated) throw new Error('Failed to update username');
		return updated;
	}
}

// Export singleton instance
export const userController = new UserController();
