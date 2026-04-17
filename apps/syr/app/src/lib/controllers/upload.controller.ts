import {
	PutObjectCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	CopyObjectCommand,
	HeadObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { QueryOptions, Upload, UploadCreate, User } from '@syr-is/types';
import { stringToRecordId, extractLocalId, extractDid } from '@syr-is/types';
import { getProfileSyncAssetUploadPath } from '$lib/instance-config';
import { s3 } from '$lib/config';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { folderRepository } from '$lib/repositories/folder.repository';
import { s3Service, s3PublicClient } from '$lib/services/s3';
import { fileStoreUsageController } from './file-store-usage.controller';
import type { RecordId } from 'surrealdb';

/**
 * Convert hex-encoded string to base64
 * S3 expects base64-encoded checksums, but we store them as hex
 */
function hexToBase64(hex: string): string {
	return Buffer.from(hex, 'hex').toString('base64');
}

export class UploadController {
	/**
	 * Build the storage key for an upload based on folder hierarchy
	 * Format: uploads/{did}/[folder_path/]{ulid}
	 */
	private async buildStorageKey(
		did: string,
		localId: string,
		folderId: RecordId | null
	): Promise<{ key: string; isPublic: boolean }> {
		let path = `uploads/${did}`;
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
			key: `${path}/${localId}`,
			isPublic
		};
	}

	/**
	 * Build URL for accessing the file
	 * Public files get direct URLs, private files get signed URLs on request
	 */
	private buildUrl(key: string): string {
		return `${s3.publicUrl}/${s3.bucket}/${key}`;
	}

	async getPutUrl(user: User, upload: UploadCreate) {
		if (!user.did) {
			throw new Error('User must have an identity (DID) to upload files');
		}
		const did = user.did;
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

		// Create initial upload record with composite ID
		let uploadRecord = await uploadRepository.createWithCompositeId(did, {
			filename: upload.filename,
			mime_type: upload.mime_type,
			size: upload.size,
			sha256: upload.sha256,
			metadata: upload.metadata,
			owner_id: user.id,
			folder_id: folderId,
			status: 'pending',
			is_public: false,
			created_at: now,
			updated_at: now
		});

		// Build storage key based on folder hierarchy
		const localId = extractLocalId(uploadRecord.id);
		const { key, isPublic } = await this.buildStorageKey(did, localId, folderId);
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
				ChecksumSHA256: hexToBase64(uploadRecord.sha256)
			})
		});

		const signedUrl = await getSignedUrl(s3PublicClient, command, {
			expiresIn: 3600
		});

		return {
			signedUrl,
			finalUrl,
			uploadId: uploadRecord.id.toString(),
			uploadDid: extractDid(uploadRecord.id),
			uploadLocalId: extractLocalId(uploadRecord.id),
			isPublic
		};
	}

	/**
	 * Get a signed PUT URL for uploading to a post's assets folder
	 * Path: uploads/{did}/posts/{post_local_id}/public/{upload_local_id}
	 * Folder hierarchy: posts → {post_local_id} → public
	 */
	async getPostAssetPutUrl(user: User, postLocalId: string, upload: UploadCreate) {
		if (!user.did) {
			throw new Error('User must have an identity (DID) to upload files');
		}
		const did = user.did;
		const now = new Date();

		// Check storage limit before allowing upload
		const storageCheck = await fileStoreUsageController.canUpload(user.id, upload.size);
		if (!storageCheck.allowed) {
			throw new Error(storageCheck.message || 'Storage limit exceeded');
		}

		// Get or create the post assets folder hierarchy: posts/{post_local_id}/public
		const postsFolder = await folderRepository.findOrCreate(user.id, 'posts', null);
		const postFolder = await folderRepository.findOrCreate(user.id, postLocalId, postsFolder.id);
		const publicFolder = await folderRepository.findOrCreate(user.id, 'public', postFolder.id);

		// Create initial upload record with composite ID
		let uploadRecord = await uploadRepository.createWithCompositeId(did, {
			filename: upload.filename,
			mime_type: upload.mime_type,
			size: upload.size,
			sha256: upload.sha256,
			metadata: upload.metadata,
			owner_id: user.id,
			folder_id: publicFolder.id,
			status: 'pending',
			is_public: true,
			created_at: now,
			updated_at: now
		});

		// Build storage key: uploads/{did}/posts/{post_local_id}/public/{upload_local_id}
		const uploadLocalId = extractLocalId(uploadRecord.id);
		const key = `uploads/${did}/posts/${postLocalId}/public/${uploadLocalId}`;
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
				ChecksumSHA256: hexToBase64(uploadRecord.sha256)
			})
		});

		const signedUrl = await getSignedUrl(s3PublicClient, command, {
			expiresIn: 3600
		});

		return {
			signedUrl,
			finalUrl,
			uploadId: uploadRecord.id.toString(),
			uploadDid: extractDid(uploadRecord.id),
			uploadLocalId: extractLocalId(uploadRecord.id),
			isPublic: true
		};
	}

	private static readonly STORY_ALLOWED_MIME = new Set([
		'image/jpeg',
		'image/png',
		'image/webp',
		'video/mp4'
	]);

	private static readonly MAX_STORY_BYTES = 50 * 1024 * 1024;

	/**
	 * Presigned PUT for a profile story slide.
	 * Path: uploads/{did}/stories/{UTC_YYYY-MM-DD}/public/{upload_local_id}
	 */
	async getStoryPutUrl(user: User, upload: UploadCreate) {
		if (!user.did) {
			throw new Error('User must have an identity (DID) to upload stories');
		}
		if (!UploadController.STORY_ALLOWED_MIME.has(upload.mime_type)) {
			throw new Error('Story media must be JPEG, PNG, WebP, or MP4');
		}
		if (upload.size > UploadController.MAX_STORY_BYTES) {
			throw new Error('Story file is too large (max 50 MB)');
		}
		const did = user.did;
		const now = new Date();

		const storageCheck = await fileStoreUsageController.canUpload(user.id, upload.size);
		if (!storageCheck.allowed) {
			throw new Error(storageCheck.message || 'Storage limit exceeded');
		}

		const utcDay = now.toISOString().slice(0, 10);
		const storiesFolder = await folderRepository.findOrCreate(user.id, 'stories', null);
		const dayFolder = await folderRepository.findOrCreate(user.id, utcDay, storiesFolder.id);
		const publicFolder = await folderRepository.findOrCreate(user.id, 'public', dayFolder.id);

		let uploadRecord = await uploadRepository.createWithCompositeId(did, {
			filename: upload.filename,
			mime_type: upload.mime_type,
			size: upload.size,
			sha256: upload.sha256,
			metadata: upload.metadata,
			owner_id: user.id,
			folder_id: publicFolder.id,
			status: 'pending',
			is_public: true,
			is_story: true,
			created_at: now,
			updated_at: now
		});

		const uploadLocalId = extractLocalId(uploadRecord.id);
		const key = `uploads/${did}/stories/${utcDay}/public/${uploadLocalId}`;
		const finalUrl = this.buildUrl(key);

		uploadRecord = await uploadRepository.update(uploadRecord.id, {
			key,
			url: finalUrl,
			updated_at: new Date()
		});

		const command = new PutObjectCommand({
			Key: key,
			ContentType: uploadRecord.mime_type,
			Bucket: s3.bucket,
			...(uploadRecord.sha256 && {
				ChecksumSHA256: hexToBase64(uploadRecord.sha256)
			})
		});

		const signedUrl = await getSignedUrl(s3PublicClient, command, {
			expiresIn: 3600
		});

		return {
			signedUrl,
			finalUrl,
			uploadId: uploadRecord.id.toString(),
			uploadDid: extractDid(uploadRecord.id),
			uploadLocalId: extractLocalId(uploadRecord.id),
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
			return pendingUpload;
		}

		if (pendingUpload.status === 'finalizing') {
			throw new Error('Upload completion already in progress');
		}

		if (pendingUpload.status !== 'pending') {
			throw new Error('Upload cannot be completed in its current state');
		}

		if (!pendingUpload.key) {
			throw new Error('Upload has no storage key');
		}

		// Verify the file in S3 matches what was requested
		try {
			console.log('[upload.complete] HeadObject:', { bucket: s3.bucket, key: pendingUpload.key });
			const headCommand = new HeadObjectCommand({
				Bucket: s3.bucket,
				Key: pendingUpload.key
			});

			const headResult = await s3Service.client.send(headCommand);
			console.log('[upload.complete] HeadObject OK:', {
				status: headResult.$metadata.httpStatusCode,
				size: headResult.ContentLength
			});
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

			// Verify checksum if both client and S3 provide SHA256
			// Note: Some S3-compatible storage (like SeaweedFS) may not return checksums in HEAD
			// responses, so we only verify when S3 actually returns the checksum
			if (pendingUpload.sha256 && headResult.ChecksumSHA256) {
				const expectedBase64 = hexToBase64(pendingUpload.sha256);
				if (headResult.ChecksumSHA256 !== expectedBase64) {
					const deleteCommand = new DeleteObjectCommand({
						Bucket: s3.bucket,
						Key: pendingUpload.key
					});
					await s3Service.client.send(deleteCommand);

					await uploadRepository.delete(uploadId);

					throw new Error('File checksum mismatch. Upload rejected.');
				}
			}
		} catch (err) {
			// If the error is one we threw, re-throw it
			if (err instanceof Error && err.message.includes('mismatch')) {
				throw err;
			}

			// Check for S3 HTTP status codes
			const httpStatusCode = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
				?.httpStatusCode;

			// If file doesn't exist in S3 (404), reject the completion
			if (httpStatusCode === 404) {
				console.error('[upload.complete] HeadObject 404:', {
					bucket: s3.bucket,
					key: pendingUpload.key,
					err
				});
				throw new Error('File not found in storage. Please upload the file first.');
			}

			// If permission denied (403), surface it clearly
			if (httpStatusCode === 403) {
				throw new Error('Permission denied accessing file in storage.');
			}

			// Re-throw other errors
			throw err;
		}

		const nowFinalize = new Date();
		const finalizingRow = await uploadRepository.casPendingToFinalizing(uploadId, nowFinalize);
		if (!finalizingRow) {
			const latest = await uploadRepository.findById(uploadId);
			if (latest?.status === 'completed') {
				return latest;
			}
			if (latest?.status === 'finalizing') {
				throw new Error('Upload completion already in progress');
			}
			throw new Error('Upload could not be marked finalizing');
		}

		let appliedBytes = 0;
		const revertFinalizingToPending = async () => {
			await uploadRepository.updateWithUnset(
				uploadId,
				{ status: 'pending', updated_at: new Date() },
				pendingUpload.is_story ? ['published_at'] : []
			);
		};

		try {
			if (pendingUpload.size > 0) {
				try {
					const { appliedBytes: applied } = await fileStoreUsageController.addUsageWithResult(
						pendingUpload.owner_id,
						pendingUpload.size,
						true
					);
					appliedBytes = applied;
					if (applied < pendingUpload.size) {
						if (applied > 0) {
							await fileStoreUsageController.subtractUsage(pendingUpload.owner_id, applied);
						}
						await revertFinalizingToPending();
						throw new Error('Storage limit exceeded. Upload rejected.');
					}
				} catch (usageErr) {
					const cur = await uploadRepository.findById(uploadId);
					if (cur?.status === 'finalizing') {
						await revertFinalizingToPending();
					}
					if (usageErr instanceof Error && usageErr.message.includes('QUOTA_EXCEEDED')) {
						throw new Error('Storage limit exceeded. Upload rejected.');
					}
					throw usageErr;
				}
			}

			const nowComplete = new Date();
			const completedRow = await uploadRepository.casFinalizingToCompleted(uploadId, nowComplete);
			if (!completedRow) {
				const latest = await uploadRepository.findById(uploadId);
				if (latest?.status === 'completed') {
					return latest;
				}
				if (pendingUpload.size > 0 && appliedBytes > 0) {
					await fileStoreUsageController.subtractUsage(pendingUpload.owner_id, appliedBytes);
				}
				await revertFinalizingToPending();
				throw new Error('Upload could not be marked completed');
			}

			return completedRow;
		} catch (err) {
			const latest = await uploadRepository.findById(uploadId);
			if (latest?.status === 'completed') {
				return latest;
			}
			if (latest?.status === 'finalizing') {
				if (pendingUpload.size > 0 && appliedBytes > 0) {
					try {
						await fileStoreUsageController.subtractUsage(pendingUpload.owner_id, appliedBytes);
					} catch {
						// best-effort rollback of KV after an unexpected failure path
					}
				}
				await revertFinalizingToPending();
			}
			throw err;
		}
	}

	async getUpload(id: RecordId | string): Promise<Upload | null> {
		return uploadRepository.findById(id);
	}

	/**
	 * Upload a profile asset (avatar or banner) from server-received bytes.
	 * Used by profile-sync endpoint when Syner POSTs multipart.
	 * Uses instance config path (default: me/profile/public) so assets are publicly accessible.
	 */
	async uploadProfileAsset(
		user: User,
		role: 'avatar' | 'banner',
		file: { buffer: ArrayBuffer; name: string; type: string }
	): Promise<string> {
		if (!user.did) {
			throw new Error('User must have an identity (DID) to upload profile assets');
		}
		const did = user.did;
		const buf = Buffer.from(file.buffer);
		const size = buf.length;
		const mimeType = file.type || 'image/png';
		const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType.replace('image/', '') || 'png';
		const localId = `profile-${role}`;

		const pathSegments = await getProfileSyncAssetUploadPath();
		const leafFolder = await folderRepository.createHierarchy(user.id, pathSegments);
		if (!leafFolder) {
			throw new Error('Failed to create profile assets folder hierarchy');
		}

		const pathStr = pathSegments.join('/');
		const key = `uploads/${did}/${pathStr}/${role}`;
		const url = this.buildUrl(key);

		const existing = await uploadRepository.findByCompositeId(did, localId);
		const deltaBytes = existing ? size - existing.size : size;

		let storageLimitMessage: string | undefined;
		if (deltaBytes > 0) {
			const storageCheck = await fileStoreUsageController.canUpload(user.id, deltaBytes);
			if (!storageCheck.allowed) {
				throw new Error(storageCheck.message || 'Storage limit exceeded');
			}
			storageLimitMessage = storageCheck.message;
		}

		await s3Service.client.send(
			new PutObjectCommand({
				Bucket: s3.bucket,
				Key: key,
				Body: buf,
				ContentType: mimeType,
				CacheControl: 'no-cache, max-age=0'
			})
		);

		if (existing && existing.key !== key) {
			await s3Service.client.send(
				new DeleteObjectCommand({
					Bucket: s3.bucket,
					Key: existing.key
				})
			);
		}

		const now = new Date();
		const uploadData = {
			key,
			owner_id: user.id,
			folder_id: leafFolder.id,
			filename: file.name || `${role}.${ext}`,
			mime_type: mimeType,
			size,
			url,
			status: 'completed' as const,
			is_public: true,
			created_at: now,
			updated_at: now
		};

		if (existing) {
			const usageDelta = size - existing.size;
			if (usageDelta !== 0) {
				if (usageDelta > 0) {
					const { appliedBytes } = await fileStoreUsageController.addUsageWithResult(
						user.id,
						usageDelta,
						true
					);
					if (appliedBytes !== usageDelta) {
						throw new Error(storageLimitMessage || 'Storage limit exceeded');
					}
				} else {
					await fileStoreUsageController.subtractUsage(user.id, -usageDelta);
				}
			}
			const { created_at: _omit, ...updatePayload } = uploadData;
			await uploadRepository.update(existing.id, updatePayload);
		} else {
			if (size > 0) {
				const { appliedBytes } = await fileStoreUsageController.addUsageWithResult(
					user.id,
					size,
					true
				);
				if (appliedBytes !== size) {
					throw new Error(storageLimitMessage || 'Storage limit exceeded');
				}
			}
			await uploadRepository.createWithExplicitId(did, localId, uploadData);
		}

		return url;
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
		uploadId: RecordId | string,
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

		// Build new key using DID from the composite record ID
		const localId = extractLocalId(upload.id);
		const uploadDid = extractDid(upload.id);
		const { key: newKey } = await this.buildStorageKey(uploadDid, localId, newFolder);

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
	 * Toggle a story upload between public and private S3 paths.
	 * Swaps /public/ ↔ /private/ in the key so anonymous S3 read rules apply correctly.
	 */
	async toggleStoryPrivacy(
		uploadId: RecordId | string,
		userId: RecordId,
		makePrivate: boolean
	): Promise<Upload> {
		const upload = await uploadRepository.findById(uploadId);
		if (!upload) throw new Error('Upload not found');
		if (upload.owner_id.toString() !== userId.toString()) {
			throw new Error('You do not have permission to modify this upload');
		}
		if (!upload.key) throw new Error('Upload has no storage key');

		const oldKey = upload.key;
		let newKey: string;

		if (makePrivate) {
			// /public/ → /private/
			newKey = oldKey.replace(/\/public\//, '/private/');
		} else {
			// /private/ → /public/
			newKey = oldKey.replace(/\/private\//, '/public/');
		}

		if (newKey === oldKey) {
			// Already in the desired state — just update the flag
			return uploadRepository.update(uploadId, {
				is_public: !makePrivate,
				updated_at: new Date()
			});
		}

		// Copy to new location
		await s3Service.client.send(
			new CopyObjectCommand({
				Bucket: s3.bucket,
				CopySource: `${s3.bucket}/${oldKey}`,
				Key: newKey,
				ContentType: upload.mime_type
			})
		);

		// Delete old location
		try {
			await s3Service.client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: oldKey }));
		} catch {
			console.warn('Failed to delete old key after privacy toggle:', oldKey);
		}

		const newUrl = this.buildUrl(newKey);
		return uploadRepository.update(uploadId, {
			key: newKey,
			url: newUrl,
			is_public: !makePrivate,
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
	async renameUpload(
		uploadId: RecordId | string,
		userId: RecordId,
		newFilename: string
	): Promise<Upload> {
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

		// Delete from database BEFORE subtracting storage usage
		// This prevents double-subtraction if this operation is retried after a DB failure
		// (If we subtracted first and DB delete failed, retry would subtract again)
		await uploadRepository.delete(id);

		// Subtract from user's storage usage (only for completed uploads)
		// If this fails after DB delete, storage will be over-counted (safer than under-counted)
		if (upload.status === 'completed' && upload.size > 0) {
			await fileStoreUsageController.subtractUsage(upload.owner_id, upload.size);
		}
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

		const signedUrl = await getSignedUrl(s3PublicClient, command, {
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

		const signedUrl = await getSignedUrl(s3PublicClient, command, {
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
