import {
	PutObjectCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	CopyObjectCommand,
	HeadObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { QueryOptions, Upload, UploadCreate, User } from '@syr-is/types';
import { stringToRecordId } from '@syr-is/types';
import { s3 } from '$lib/config';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { folderRepository } from '$lib/repositories/folder.repository';
import { s3Service } from '$lib/services/s3';
import { fileStoreUsageController } from './file-store-usage.controller';
import type { RecordId } from 'surrealdb';

export class UploadController {
	/**
	 * Build the storage key for an upload based on folder hierarchy
	 * Format: uploads/{user_id}/[folder_path/]{record_id}
	 */
	private async buildStorageKey(
		userId: string,
		recordId: string,
		folderId: RecordId | null
	): Promise<{ key: string; isPublic: boolean }> {
		let path = `uploads/${userId}`;
		let isPublic = false;

		if (folderId) {
			const folderPath = await folderRepository.getFullPath(folderId);
			if (folderPath.length > 0) {
				path += '/' + folderPath.join('/');

				// Check if this is in the public hierarchy
				isPublic = await folderRepository.isInPublicHierarchy(folderId);
			}
		}

		return {
			key: `${path}/${recordId}`,
			isPublic
		};
	}

	/**
	 * Build URL for accessing the file
	 * Public files get direct URLs, private files get signed URLs on request
	 */
	private buildUrl(key: string): string {
		return `${s3.endpoint}/${s3.bucket}/${key}`;
	}

	async getPutUrl(user: User, upload: UploadCreate) {
		const userId = user.id.toString();
		const now = new Date();

		// Check storage limit before allowing upload
		const storageCheck = await fileStoreUsageController.canUpload(user.id, upload.size);
		if (!storageCheck.allowed) {
			throw new Error(storageCheck.message || 'Storage limit exceeded');
		}

		// Parse folder_id if provided
		const folderId = upload.folder_id ? stringToRecordId.decode(upload.folder_id) : null;

		// Verify folder ownership if folder is specified
		if (folderId) {
			const folder = await folderRepository.findById(folderId);
			if (!folder) {
				throw new Error('Folder not found');
			}
			if (folder.owner_id.toString() !== userId) {
				throw new Error('You do not have permission to upload to this folder');
			}
		}

		// Create initial upload record
		let uploadRecord = await uploadRepository.create({
			filename: upload.filename,
			mime_type: upload.mime_type,
			size: upload.size,
			sha256: upload.sha256,
			metadata: upload.metadata,
			owner_id: user.id,
			folder_id: folderId,
			status: 'pending',
			is_public: false, // Will be updated after we determine the path
			created_at: now,
			updated_at: now
		});

		// Build storage key based on folder hierarchy
		const recordId = uploadRecord.id.toString();
		const { key, isPublic } = await this.buildStorageKey(userId, recordId, folderId);
		const finalUrl = this.buildUrl(key);

		// Update record with key, url, and public status
		uploadRecord = await uploadRepository.update(uploadRecord.id, {
			key,
			url: finalUrl,
			is_public: isPublic,
			updated_at: new Date()
		});

		// Create signed URL for upload
		const command = new PutObjectCommand({
			Key: key,
			ContentType: uploadRecord.mime_type,
			Bucket: s3.bucket,
			...(uploadRecord.sha256 && {
				ChecksumSHA256: uploadRecord.sha256
			})
		});

		const signedUrl = await getSignedUrl(s3Service.client, command, {
			expiresIn: 3600
		});

		return {
			signedUrl,
			finalUrl,
			uploadId: uploadRecord.id.toString(),
			isPublic
		};
	}

	/**
	 * Get a signed PUT URL for uploading to a post's assets folder
	 * Path: uploads/{user_id}/posts/{post_id}/public/{record_id}
	 * Folder hierarchy: posts → {post_id} → public
	 */
	async getPostAssetPutUrl(user: User, postId: string, upload: UploadCreate) {
		const userId = user.id.toString();
		const now = new Date();

		// Check storage limit before allowing upload
		const storageCheck = await fileStoreUsageController.canUpload(user.id, upload.size);
		if (!storageCheck.allowed) {
			throw new Error(storageCheck.message || 'Storage limit exceeded');
		}

		// Get or create the post assets folder hierarchy: posts/{post_id}/public
		const postsFolder = await folderRepository.findOrCreate(user.id, 'posts', null);
		const postFolder = await folderRepository.findOrCreate(user.id, postId, postsFolder.id);
		const publicFolder = await folderRepository.findOrCreate(user.id, 'public', postFolder.id);

		// Create initial upload record
		let uploadRecord = await uploadRepository.create({
			filename: upload.filename,
			mime_type: upload.mime_type,
			size: upload.size,
			sha256: upload.sha256,
			metadata: upload.metadata,
			owner_id: user.id,
			folder_id: publicFolder.id,
			status: 'pending',
			is_public: true, // Post assets are always public (in public folder)
			created_at: now,
			updated_at: now
		});

		// Build storage key: uploads/{user_id}/posts/{post_id}/public/{record_id}
		const recordId = uploadRecord.id.toString();
		const key = `uploads/${userId}/posts/${postId}/public/${recordId}`;
		const finalUrl = this.buildUrl(key);

		// Update record with key and url
		uploadRecord = await uploadRepository.update(uploadRecord.id, {
			key,
			url: finalUrl,
			updated_at: new Date()
		});

		// Create signed URL for upload
		const command = new PutObjectCommand({
			Key: key,
			ContentType: uploadRecord.mime_type,
			Bucket: s3.bucket,
			...(uploadRecord.sha256 && {
				ChecksumSHA256: uploadRecord.sha256
			})
		});

		const signedUrl = await getSignedUrl(s3Service.client, command, {
			expiresIn: 3600
		});

		return {
			signedUrl,
			finalUrl,
			uploadId: uploadRecord.id.toString(),
			isPublic: true
		};
	}

	async completeUpload(uploadId: string | RecordId) {
		// Get the pending upload record
		const pendingUpload = await uploadRepository.findById(uploadId);
		if (!pendingUpload) {
			throw new Error('Upload not found');
		}

		if (pendingUpload.status === 'completed') {
			throw new Error('Upload already completed');
		}

		if (!pendingUpload.key) {
			throw new Error('Upload has no storage key');
		}

		// Verify the file in S3 matches what was requested
		try {
			const headCommand = new HeadObjectCommand({
				Bucket: s3.bucket,
				Key: pendingUpload.key
			});

			const headResult = await s3Service.client.send(headCommand);
			const actualSize = headResult.ContentLength ?? 0;

			// Verify file size matches
			if (actualSize !== pendingUpload.size) {
				// Delete the mismatched file from S3
				const deleteCommand = new DeleteObjectCommand({
					Bucket: s3.bucket,
					Key: pendingUpload.key
				});
				await s3Service.client.send(deleteCommand);

				// Delete the upload record
				await uploadRepository.delete(uploadId);

				throw new Error(
					`File size mismatch: expected ${pendingUpload.size} bytes, got ${actualSize} bytes. Upload rejected.`
				);
			}

			// Verify checksum if provided (S3 returns base64-encoded SHA256)
			if (pendingUpload.sha256 && headResult.ChecksumSHA256) {
				// Convert hex to base64 for comparison
				const expectedBase64 = Buffer.from(pendingUpload.sha256, 'hex').toString('base64');
				if (headResult.ChecksumSHA256 !== expectedBase64) {
					// Delete the mismatched file from S3
					const deleteCommand = new DeleteObjectCommand({
						Bucket: s3.bucket,
						Key: pendingUpload.key
					});
					await s3Service.client.send(deleteCommand);

					// Delete the upload record
					await uploadRepository.delete(uploadId);

					throw new Error('File checksum mismatch. Upload rejected.');
				}
			}
		} catch (err) {
			// If the error is one we threw, re-throw it
			if (err instanceof Error && err.message.includes('mismatch')) {
				throw err;
			}

			// If file doesn't exist in S3, reject the completion
			if (err instanceof Error && err.name === 'NotFound') {
				throw new Error('File not found in storage. Please upload the file first.');
			}

			// Re-throw other errors
			throw err;
		}

		// File verified, complete the upload
		const uploadRecord = await uploadRepository.update(uploadId, {
			status: 'completed',
			updated_at: new Date()
		});

		// Add to user's storage usage
		if (uploadRecord && uploadRecord.size > 0) {
			await fileStoreUsageController.addUsage(uploadRecord.owner_id, uploadRecord.size);
		}

		return uploadRecord;
	}

	async getUpload(id: RecordId | string): Promise<Upload | null> {
		return uploadRepository.findById(id);
	}

	/**
	 * Get uploads for a user, optionally filtered by folder
	 */
	async getUserUploads(
		userId: RecordId,
		options: Partial<QueryOptions> & { folder_id?: string | null } = {
			sort: { field: 'created_at', order: 'desc' }
		}
	) {
		const { folder_id, ...queryOptions } = options;

		// Build filters
		const filters: Record<string, unknown> = { owner_id: userId };

		if (folder_id === null) {
			// Explicitly requesting root level files (no folder)
			filters.folder_id = null;
		} else if (folder_id) {
			// Filter by specific folder
			filters.folder_id = stringToRecordId.decode(folder_id);
		}
		// If folder_id is undefined, return all uploads regardless of folder

		const uploads = await uploadRepository.findMany({
			...queryOptions,
			filters
		});

		return uploads;
	}

	async updateUpload(id: RecordId | string, data: Partial<Upload>) {
		const uploadRecord = await uploadRepository.update(id, {
			...data,
			updated_at: new Date()
		});
		return uploadRecord;
	}

	/**
	 * Move an upload to a different folder
	 * This performs a copy + delete operation in S3
	 */
	async moveUpload(
		uploadId: string,
		userId: RecordId,
		newFolderId: string | null
	): Promise<Upload> {
		const upload = await uploadRepository.findById(uploadId);
		if (!upload) {
			throw new Error('Upload not found');
		}

		if (upload.owner_id.toString() !== userId.toString()) {
			throw new Error('You do not have permission to move this upload');
		}

		if (!upload.key) {
			throw new Error('Upload has no storage key');
		}

		const oldKey = upload.key;
		const newFolder = newFolderId ? stringToRecordId.decode(newFolderId) : null;

		// Verify new folder ownership
		if (newFolder) {
			const folder = await folderRepository.findById(newFolder);
			if (!folder || folder.owner_id.toString() !== userId.toString()) {
				throw new Error('Destination folder not found or not accessible');
			}
		}

		// Determine if the new location is public
		const isPublic = newFolder ? await folderRepository.isInPublicHierarchy(newFolder) : false;

		// Build new key
		const recordId = upload.id.toString();
		const userIdStr = userId.toString();
		const { key: newKey } = await this.buildStorageKey(userIdStr, recordId, newFolder);

		// Skip if the key hasn't changed
		if (oldKey === newKey) {
			return upload;
		}

		// Copy the file to the new location in S3
		const copyCommand = new CopyObjectCommand({
			Bucket: s3.bucket,
			CopySource: `${s3.bucket}/${oldKey}`,
			Key: newKey,
			ContentType: upload.mime_type
		});

		try {
			await s3Service.client.send(copyCommand);
		} catch (error) {
			console.error('Failed to copy file in S3:', error);
			throw new Error('Failed to move file: copy operation failed');
		}

		// Delete the old file
		const deleteCommand = new DeleteObjectCommand({
			Bucket: s3.bucket,
			Key: oldKey
		});

		try {
			await s3Service.client.send(deleteCommand);
		} catch (error) {
			// Log but don't fail - the file was copied successfully
			console.warn('Failed to delete old file after move:', error);
		}

		const newUrl = this.buildUrl(newKey);

		return uploadRepository.update(uploadId, {
			folder_id: newFolder,
			key: newKey,
			url: newUrl,
			is_public: isPublic,
			updated_at: new Date()
		});
	}

	/**
	 * Rename an upload
	 * @param uploadId Upload ID
	 * @param userId User ID (for ownership verification)
	 * @param newFilename New filename
	 * @returns Updated upload
	 */
	async renameUpload(uploadId: string, userId: RecordId, newFilename: string): Promise<Upload> {
		const upload = await uploadRepository.findById(uploadId);
		if (!upload) {
			throw new Error('Upload not found');
		}

		if (upload.owner_id.toString() !== userId.toString()) {
			throw new Error('You do not have permission to rename this upload');
		}

		return uploadRepository.update(uploadId, {
			filename: newFilename,
			updated_at: new Date()
		});
	}

	async deleteUpload(id: RecordId | string): Promise<void> {
		const upload = await uploadRepository.findById(id);
		if (!upload) {
			throw new Error('Upload not found');
		}

		// Delete from S3 if key exists
		if (upload.key) {
			const command = new DeleteObjectCommand({
				Bucket: s3.bucket,
				Key: upload.key
			});
			await s3Service.client.send(command);
		}

		// Subtract from user's storage usage (only for completed uploads)
		if (upload.status === 'completed' && upload.size > 0) {
			await fileStoreUsageController.subtractUsage(upload.owner_id, upload.size);
		}

		// Delete from database
		await uploadRepository.delete(id);
	}

	/**
	 * Get download URL for a file
	 * Public files return direct URL, private files return signed URL
	 */
	async getDownloadUrl(id: RecordId | string): Promise<{ url: string; isPublic: boolean } | null> {
		const upload = await uploadRepository.findById(id);
		if (!upload || !upload.key) {
			return null;
		}

		// Public files can be accessed directly
		if (upload.is_public) {
			return {
				url: upload.url || this.buildUrl(upload.key),
				isPublic: true
			};
		}

		// Private files need signed URLs
		const command = new GetObjectCommand({
			Bucket: s3.bucket,
			Key: upload.key
		});

		const signedUrl = await getSignedUrl(s3Service.client, command, {
			expiresIn: 3600
		});

		return {
			url: signedUrl,
			isPublic: false
		};
	}

	/**
	 * Legacy method for backward compatibility
	 * @deprecated Use getDownloadUrl instead
	 */
	async getSignedDownloadUrl(id: RecordId | string): Promise<string | null> {
		const result = await this.getDownloadUrl(id);
		return result?.url || null;
	}

	/**
	 * Generate a presigned URL for sharing a file with custom expiry
	 * @param id Upload ID
	 * @param expiresIn Expiry time in seconds (default: 3600 = 1 hour, max: 604800 = 7 days)
	 * @returns Presigned URL and expiry information
	 */
	async getShareUrl(
		id: RecordId | string,
		expiresIn: number = 3600
	): Promise<{ url: string; expiresAt: Date; isPublic: boolean } | null> {
		const upload = await uploadRepository.findById(id);
		if (!upload || !upload.key) {
			return null;
		}

		// Cap expiry at 7 days (S3 maximum for presigned URLs)
		const maxExpiry = 604800; // 7 days in seconds
		const safeExpiry = Math.min(Math.max(expiresIn, 60), maxExpiry);
		const expiresAt = new Date(Date.now() + safeExpiry * 1000);

		// Public files can be accessed directly (no expiry)
		if (upload.is_public) {
			return {
				url: upload.url || this.buildUrl(upload.key),
				expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Effectively never expires
				isPublic: true
			};
		}

		// Private files need signed URLs
		const command = new GetObjectCommand({
			Bucket: s3.bucket,
			Key: upload.key
		});

		const signedUrl = await getSignedUrl(s3Service.client, command, {
			expiresIn: safeExpiry
		});

		return {
			url: signedUrl,
			expiresAt,
			isPublic: false
		};
	}
}

export const uploadController = new UploadController();
