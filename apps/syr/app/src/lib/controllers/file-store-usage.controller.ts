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
 * Maximum storage allowed per user (5GB) — instance default
 */
export const MAX_STORAGE_BYTES = 5 * 1024 * 1024 * 1024; // 5GB

/**
 * KV type for per-user storage limit overrides
 */
const KV_LIMIT_TYPE = 'file_store_limit_override';

interface FileStoreLimitOverride {
	bytes_limit: number;
}

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
	 * Get the effective storage limit for a user.
	 * Checks for a per-user override in KV, falls back to instance default.
	 */
	async getUserLimit(userId: RecordId | string): Promise<number> {
		const index = this.getUserIndex(userId);
		const override = await kvService.get<FileStoreLimitOverride>(KV_LIMIT_TYPE, index);
		if (override !== null && typeof override.bytes_limit === 'number' && override.bytes_limit > 0) {
			return override.bytes_limit;
		}
		return MAX_STORAGE_BYTES;
	}

	/**
	 * Set a per-user storage limit override.
	 */
	async setUserLimit(userId: RecordId | string, bytesLimit: number): Promise<void> {
		const index = this.getUserIndex(userId);
		await kvService.set<FileStoreLimitOverride>(KV_LIMIT_TYPE, index, { bytes_limit: bytesLimit });
	}

	/**
	 * Clear per-user storage limit override, reverting to instance default.
	 */
	async clearUserLimit(userId: RecordId | string): Promise<void> {
		const index = this.getUserIndex(userId);
		await kvService.delete(KV_LIMIT_TYPE, index);
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
	 * If no KV entry exists, calculates from existing uploads and creates the entry atomically
	 * Uses create-if-absent to avoid overwriting concurrent updates from addUsage
	 */
	async getUsage(userId: RecordId | string): Promise<number> {
		const index = this.getUserIndex(userId);

		// First try to get existing value
		const data = await kvService.get<FileStoreUsageData>(KV_TYPE, index);
		if (data !== null) {
			return data.bytes_used ?? 0;
		}

		// No entry exists - calculate from uploads and try to create atomically
		const calculatedUsage = await this.calculateUsageFromUploads(userId);

		// Use createIfAbsent to avoid overwriting concurrent updates
		// If another process created the record between our get and createIfAbsent,
		// createIfAbsent returns false and we fetch the current value
		const created = await kvService.createIfAbsent(KV_TYPE, index, {
			bytes_used: Math.max(0, calculatedUsage)
		} as FileStoreUsageData);

		if (created) {
			// We successfully created the initial record
			return calculatedUsage;
		}

		// Another process created the record - fetch the current value
		// This handles the race condition where addUsage ran between our check and create
		const currentData = await kvService.get<FileStoreUsageData>(KV_TYPE, index);
		return currentData?.bytes_used ?? 0;
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
		const bytesLimit = await this.getUserLimit(userId);
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
	 * Add to user's storage usage; returns totals from the same atomic op when quota is enforced.
	 * @param enforceQuota - If true, uses min+max atomic increment and returns appliedBytes from that transaction
	 * @throws Error with message 'QUOTA_EXCEEDED' if enforceQuota is true and quota would be exceeded
	 */
	async addUsageWithResult(
		userId: RecordId | string,
		bytes: number,
		enforceQuota: boolean = false
	): Promise<{ newTotal: number; appliedBytes: number }> {
		if (bytes <= 0) {
			const newTotal = await this.getUsage(userId);
			return { newTotal, appliedBytes: 0 };
		}

		const index = this.getUserIndex(userId);

		if (enforceQuota) {
			const limit = await this.getUserLimit(userId);
			return kvService.atomicIncrementFieldWithApplied(
				KV_TYPE,
				index,
				'bytes_used',
				bytes,
				0,
				limit
			);
		}

		const newTotal = await kvService.atomicIncrementField(
			KV_TYPE,
			index,
			'bytes_used',
			bytes,
			0,
			undefined
		);
		return { newTotal, appliedBytes: bytes };
	}

	/**
	 * Add to user's storage usage (for uploads)
	 * Uses atomic increment with max cap to prevent race conditions and enforce quota
	 * @param userId - User ID
	 * @param bytes - Number of bytes to add
	 * @param enforceQuota - If true, throws QUOTA_EXCEEDED if increment would exceed MAX_STORAGE_BYTES
	 * @returns The new total bytes used
	 * @throws Error with message 'QUOTA_EXCEEDED' if enforceQuota is true and quota would be exceeded
	 */
	async addUsage(
		userId: RecordId | string,
		bytes: number,
		enforceQuota: boolean = false
	): Promise<number> {
		const { newTotal } = await this.addUsageWithResult(userId, bytes, enforceQuota);
		return newTotal;
	}

	/**
	 * Subtract from user's storage usage (for deletions)
	 * Uses atomic decrement to prevent race conditions
	 * @param userId - User ID
	 * @param bytes - Number of bytes to subtract
	 * @returns The new total bytes used (never goes below 0)
	 */
	async subtractUsage(userId: RecordId | string, bytes: number): Promise<number> {
		if (bytes <= 0) return this.getUsage(userId);

		const index = this.getUserIndex(userId);
		// Use negative amount for decrement, with minValue of 0 to prevent negative values
		return kvService.atomicIncrementField(KV_TYPE, index, 'bytes_used', -bytes, 0);
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
		const limit = await this.getUserLimit(userId);
		const availableSpace = Math.max(0, limit - currentUsage);
		const allowed = currentUsage + bytes <= limit;

		return {
			allowed,
			current_usage: currentUsage,
			required_space: bytes,
			available_space: availableSpace,
			message: allowed
				? undefined
				: `Storage limit exceeded. You need ${formatBytes(bytes)} but only have ${formatBytes(availableSpace)} available.`
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
