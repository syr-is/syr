import { ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import type { Folder, FolderCreate, FolderUpdate } from '@syr-is/types';
import { stringToRecordId } from '@syr-is/types';
import { identityRepository } from '$lib/repositories/identity.repository';
import { folderRepository } from '$lib/repositories/folder.repository';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { s3Service } from '$lib/services/s3';
import { s3 } from '$lib/config';
import { fileStoreUsageController } from './file-store-usage.controller';
import type { RecordId } from 'surrealdb';

export class FolderController {
	/**
	 * Delete all objects in S3 with a given prefix (folder path)
	 * This handles folder marker objects and any remaining files
	 */
	private async deleteS3Prefix(prefix: string): Promise<void> {
		try {
			let continuationToken: string | undefined;
			do {
				// List all objects with the prefix
				const listResponse = await s3Service.client.send(
					new ListObjectsV2Command({
						Bucket: s3.bucket,
						Prefix: prefix,
						ContinuationToken: continuationToken
					})
				);

				if (listResponse.Contents && listResponse.Contents.length > 0) {
					// Delete objects in batches (S3 allows up to 1000 per request)
					const deleteCommand = new DeleteObjectsCommand({
						Bucket: s3.bucket,
						Delete: {
							Objects: listResponse.Contents.map((obj) => ({ Key: obj.Key })),
							Quiet: true
						}
					});
					await s3Service.client.send(deleteCommand);
				}

				continuationToken = listResponse.NextContinuationToken;
			} while (continuationToken);
		} catch (error) {
			// Log but don't fail - the database records are already deleted
			console.warn('Failed to delete S3 prefix:', prefix, error);
		}
	}

	/**
	 * Build the S3 prefix for a folder based on its path.
	 * Format: uploads/{did}/[folder_path/]
	 * Caller must ensure did is validated (identity exists).
	 */
	private async buildS3Prefix(did: string, folderId: RecordId): Promise<string> {
		const folderPath = await folderRepository.getFullPath(folderId);
		let prefix = `uploads/${did}`;
		if (folderPath.length > 0) {
			prefix += '/' + folderPath.join('/');
		}
		return prefix + '/';
	}

	/**
	 * Create a new folder
	 */
	async createFolder(ownerId: RecordId, data: FolderCreate): Promise<Folder> {
		const now = new Date();
		const parentId = data.parent_id ? stringToRecordId.decode(data.parent_id) : null;

		// Check if folder with same name exists in same parent
		const existing = await folderRepository.findByNameAndParent(ownerId, data.name, parentId);
		if (existing) {
			throw new Error(`Folder "${data.name}" already exists in this location`);
		}

		return folderRepository.create({
			name: data.name,
			owner_id: ownerId,
			parent_id: parentId,
			created_at: now,
			updated_at: now
		});
	}

	/**
	 * Get folders at a specific level (root or inside a parent folder)
	 */
	async getFolders(ownerId: RecordId, parentId: string | null = null): Promise<Folder[]> {
		const parentRecordId = parentId ? stringToRecordId.decode(parentId) : null;
		return folderRepository.findByParent(ownerId, parentRecordId);
	}

	/**
	 * Get a single folder by ID
	 */
	async getFolder(folderId: string): Promise<Folder | null> {
		return folderRepository.findById(folderId);
	}

	/**
	 * Update a folder
	 */
	async updateFolder(folderId: string, ownerId: RecordId, data: FolderUpdate): Promise<Folder> {
		const folder = await folderRepository.findById(folderId);
		if (!folder) {
			throw new Error('Folder not found');
		}

		// Verify ownership
		if (folder.owner_id.toString() !== ownerId.toString()) {
			throw new Error('You do not have permission to update this folder');
		}

		// If renaming, check for conflicts
		if (data.name && data.name !== folder.name) {
			const parentId =
				data.parent_id !== undefined
					? data.parent_id
						? stringToRecordId.decode(data.parent_id)
						: null
					: (folder.parent_id ?? null);

			const existing = await folderRepository.findByNameAndParent(ownerId, data.name, parentId);
			if (existing && existing.id.toString() !== folderId) {
				throw new Error(`Folder "${data.name}" already exists in this location`);
			}
		}

		// If moving, check for circular reference
		if (data.parent_id !== undefined) {
			const newParentId = data.parent_id ? stringToRecordId.decode(data.parent_id) : null;

			if (newParentId) {
				// Can't move folder into itself
				if (newParentId.toString() === folderId) {
					throw new Error('Cannot move folder into itself');
				}

				// Can't move folder into its descendants
				const descendants = await folderRepository.getDescendantIds(folder.id);
				if (descendants.some((d) => d.toString() === newParentId.toString())) {
					throw new Error('Cannot move folder into one of its subfolders');
				}
			}
		}

		const updateData: Partial<Folder> = {
			updated_at: new Date()
		};

		if (data.name !== undefined) {
			updateData.name = data.name;
		}

		if (data.parent_id !== undefined) {
			updateData.parent_id = data.parent_id ? stringToRecordId.decode(data.parent_id) : null;
		}

		return folderRepository.update(folderId, updateData);
	}

	/**
	 * Delete a folder (and optionally its contents)
	 */
	async deleteFolder(folderId: string, ownerId: RecordId, deleteContents = false): Promise<void> {
		const folder = await folderRepository.findById(folderId);
		if (!folder) {
			throw new Error('Folder not found');
		}

		// Verify ownership
		if (folder.owner_id.toString() !== ownerId.toString()) {
			throw new Error('You do not have permission to delete this folder');
		}

		// Check for child folders
		const childFolders = await folderRepository.findByParent(ownerId, folder.id);
		if (childFolders.length > 0 && !deleteContents) {
			throw new Error(
				'Folder contains subfolders. Use deleteContents=true to delete all contents.'
			);
		}

		// Check for uploads in this folder
		const { data: uploads } = await uploadRepository.findMany({
			filters: { folder_id: folder.id }
		});
		if (uploads.length > 0 && !deleteContents) {
			throw new Error('Folder contains files. Use deleteContents=true to delete all contents.');
		}

		if (deleteContents) {
			// Resolve identity for S3 prefix; fail fast before any DB deletions
			const identity = await identityRepository.findByUserId(ownerId);
			if (!identity) {
				throw new Error('identity not found for ownerId');
			}
			const s3Prefix = await this.buildS3Prefix(identity.did, folder.id);

			// Track total bytes to subtract from storage usage
			let totalBytesToDelete = 0;

			// Delete all descendant folders and their contents from database
			const descendants = await folderRepository.getDescendantIds(folder.id);
			for (const descendantId of descendants) {
				// Delete uploads in descendant folder from database
				const { data: descendantUploads } = await uploadRepository.findMany({
					filters: { folder_id: descendantId }
				});
				for (const upload of descendantUploads) {
					// Track completed upload sizes for storage usage
					if (upload.status === 'completed' && upload.size > 0) {
						totalBytesToDelete += upload.size;
					}
					// Just delete from database - we'll bulk delete from S3
					await uploadRepository.delete(upload.id);
				}
				await folderRepository.delete(descendantId);
			}

			// Delete uploads in the target folder from database
			for (const upload of uploads) {
				// Track completed upload sizes for storage usage
				if (upload.status === 'completed' && upload.size > 0) {
					totalBytesToDelete += upload.size;
				}
				await uploadRepository.delete(upload.id);
			}

			// Subtract total deleted bytes from user's storage usage
			if (totalBytesToDelete > 0) {
				await fileStoreUsageController.subtractUsage(ownerId, totalBytesToDelete);
			}

			// Bulk delete all S3 objects under this folder prefix
			// This handles files, folder markers, and any orphaned objects
			await this.deleteS3Prefix(s3Prefix);
		}

		await folderRepository.delete(folderId);
	}

	/**
	 * Get the full path of a folder
	 */
	async getFolderPath(folderId: string): Promise<string[]> {
		return folderRepository.getFullPath(folderId);
	}

	/**
	 * Check if a folder is in the public hierarchy
	 */
	async isPublic(folderId: string): Promise<boolean> {
		return folderRepository.isInPublicHierarchy(folderId);
	}

	/**
	 * Get or create the public folder for a user
	 */
	async getOrCreatePublicFolder(ownerId: RecordId): Promise<Folder> {
		return folderRepository.findOrCreate(ownerId, 'public', null);
	}

	/**
	 * Get or create a post assets folder
	 * Path: posts/{post_id}/public
	 */
	async getOrCreatePostAssetsFolder(ownerId: RecordId, postId: string): Promise<Folder> {
		const postsFolder = await folderRepository.findOrCreate(ownerId, 'posts', null);
		const postFolder = await folderRepository.findOrCreate(ownerId, postId, postsFolder.id);
		return folderRepository.findOrCreate(ownerId, 'public', postFolder.id);
	}

	/**
	 * Get folder breadcrumb trail
	 */
	async getBreadcrumbs(folderId: string | null): Promise<Array<{ id: string; name: string }>> {
		if (!folderId) return [];

		const breadcrumbs: Array<{ id: string; name: string }> = [];
		let currentFolder = await folderRepository.findById(folderId);

		while (currentFolder) {
			breadcrumbs.unshift({
				id: currentFolder.id.toString(),
				name: currentFolder.name
			});

			if (currentFolder.parent_id) {
				currentFolder = await folderRepository.findById(currentFolder.parent_id);
			} else {
				break;
			}
		}

		return breadcrumbs;
	}
}

export const folderController = new FolderController();
