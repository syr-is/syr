import { kvService } from '$lib/services/kv';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { stringToRecordId } from '@syr-is/types';
import type { RecordId } from 'surrealdb';

/**
 * KV type for file storage usage
 */
const KV_TYPE = 'file_store_usage';

/**
 * File Store Usage Data Structure
 * Stored in KV as kv:file_store_usage:user_id
 */
interface FileStoreUsageData {
	/** Total bytes used by the user's uploads */
	bytes_used: number;
}

/**
 * Maximum storage allowed per user (5GB)
 */
export const MAX_STORAGE_BYTES = 5 * 1024 * 1024 * 1024; // 5GB

/**
 * File Store Usage Controller
 * Manages aggregated file storage usage for users using KV storage
 */
export class FileStoreUsageController {
	/**
	 * Get the KV index for a user's storage usage
	 */
	private getUserIndex(userId: RecordId | string): string {
		return typeof userId === 'string' ? userId : userId.toString();
	}

	/**
	 * Convert userId to RecordId if it's a string
	 */
	private toRecordId(userId: RecordId | string): RecordId {
		return typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
	}

	/**
	 * Calculate total storage usage from existing uploads
	 * Only counts completed uploads
	 */
	private async calculateUsageFromUploads(userId: RecordId | string): Promise<number> {
		const recordId = this.toRecordId(userId);

		// Fetch all completed uploads for the user
		// We need to paginate through all uploads to get the complete total
		let totalBytes = 0;
		let offset = 0;
		const limit = 100;
		let hasMore = true;

		while (hasMore) {
			const { data: uploads, total } = await uploadRepository.findMany({
				filters: { owner_id: recordId, status: 'completed' },
				limit,
				offset
			});

			for (const upload of uploads) {
				if (upload.size > 0) {
					totalBytes += upload.size;
				}
			}

			offset += limit;
			hasMore = offset < total;
		}

		return totalBytes;
	}

	/**
	 * Get user's current storage usage in bytes
	 * If no KV entry exists, calculates from existing uploads and creates the entry
	 */
	async getUsage(userId: RecordId | string): Promise<number> {
		const index = this.getUserIndex(userId);

		// Check if KV entry exists
		const exists = await kvService.has(KV_TYPE, index);

		if (!exists) {
			// Calculate from existing uploads and save
			const calculatedUsage = await this.calculateUsageFromUploads(userId);
			await this.saveUsage(userId, calculatedUsage);
			return calculatedUsage;
		}

		const data = await kvService.get<FileStoreUsageData>(KV_TYPE, index);
		return data?.bytes_used ?? 0;
	}

	/**
	 * Get user's storage usage with additional metadata
	 */
	async getUsageDetails(userId: RecordId | string): Promise<{
		bytes_used: number;
		bytes_limit: number;
		percentage_used: number;
		bytes_remaining: number;
	}> {
		const bytesUsed = await this.getUsage(userId);
		const bytesLimit = MAX_STORAGE_BYTES;
		const percentageUsed = (bytesUsed / bytesLimit) * 100;
		const bytesRemaining = Math.max(0, bytesLimit - bytesUsed);

		return {
			bytes_used: bytesUsed,
			bytes_limit: bytesLimit,
			percentage_used: Math.min(100, percentageUsed),
			bytes_remaining: bytesRemaining
		};
	}

	/**
	 * Save storage usage data
	 */
	private async saveUsage(userId: RecordId | string, bytesUsed: number): Promise<void> {
		const index = this.getUserIndex(userId);
		const data: FileStoreUsageData = { bytes_used: Math.max(0, bytesUsed) };
		await kvService.set(KV_TYPE, index, data);
	}

	/**
	 * Add to user's storage usage (for uploads)
	 * @param userId - User ID
	 * @param bytes - Number of bytes to add
	 * @returns The new total bytes used
	 */
	async addUsage(userId: RecordId | string, bytes: number): Promise<number> {
		if (bytes <= 0) return this.getUsage(userId);

		const currentUsage = await this.getUsage(userId);
		const newUsage = currentUsage + bytes;
		await this.saveUsage(userId, newUsage);
		return newUsage;
	}

	/**
	 * Subtract from user's storage usage (for deletions)
	 * @param userId - User ID
	 * @param bytes - Number of bytes to subtract
	 * @returns The new total bytes used (never goes below 0)
	 */
	async subtractUsage(userId: RecordId | string, bytes: number): Promise<number> {
		if (bytes <= 0) return this.getUsage(userId);

		const currentUsage = await this.getUsage(userId);
		const newUsage = Math.max(0, currentUsage - bytes);
		await this.saveUsage(userId, newUsage);
		return newUsage;
	}

	/**
	 * Set user's storage usage to a specific value (for recalculation/sync)
	 * @param userId - User ID
	 * @param bytes - Total bytes to set
	 */
	async setUsage(userId: RecordId | string, bytes: number): Promise<void> {
		await this.saveUsage(userId, bytes);
	}

	/**
	 * Check if user has enough storage space for a new upload
	 * @param userId - User ID
	 * @param bytes - Size of the new upload in bytes
	 * @returns Object indicating if upload is allowed and current usage
	 */
	async canUpload(
		userId: RecordId | string,
		bytes: number
	): Promise<{
		allowed: boolean;
		current_usage: number;
		required_space: number;
		available_space: number;
		message?: string;
	}> {
		const currentUsage = await this.getUsage(userId);
		const availableSpace = Math.max(0, MAX_STORAGE_BYTES - currentUsage);
		const allowed = currentUsage + bytes <= MAX_STORAGE_BYTES;

		return {
			allowed,
			current_usage: currentUsage,
			required_space: bytes,
			available_space: availableSpace,
			message: allowed
				? undefined
				: `Not enough storage space. You need ${formatBytes(bytes)} but only have ${formatBytes(availableSpace)} available.`
		};
	}

	/**
	 * Clear storage usage for a user (for cleanup/reset)
	 */
	async clearUsage(userId: RecordId | string): Promise<void> {
		const index = this.getUserIndex(userId);
		await kvService.delete(KV_TYPE, index);
	}
}

/**
 * Helper function to format bytes to human readable string
 */
function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 Bytes';
	const k = 1024;
	const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Export singleton instance
export const fileStoreUsageController = new FileStoreUsageController();
