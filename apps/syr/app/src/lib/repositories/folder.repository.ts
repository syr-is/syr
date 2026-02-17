import { FolderSchema, type Folder, stringToRecordId } from '@syr-is/types';
import { BaseRepository } from './base.repository';
import type { RecordId } from 'surrealdb';

export class FolderRepository extends BaseRepository<Folder> {
	protected tableName = 'folder';
	protected schema = FolderSchema;

	/**
	 * Find all folders for a user
	 */
	async findByOwner(ownerId: RecordId): Promise<Folder[]> {
		const result = await this.db.query<[Folder[]]>(
			`SELECT * FROM ${this.tableName} WHERE owner_id = $owner_id ORDER BY name ASC`,
			{ owner_id: ownerId }
		);
		return (result[0] ?? []).map((record) => this.validate(record));
	}

	/**
	 * Find folders by parent ID (for navigating folder hierarchy)
	 */
	async findByParent(ownerId: RecordId, parentId: RecordId | null): Promise<Folder[]> {
		let query: string;
		const params: Record<string, unknown> = { owner_id: ownerId };

		if (parentId === null) {
			query = `SELECT * FROM ${this.tableName} WHERE owner_id = $owner_id AND parent_id IS NULL ORDER BY name ASC`;
		} else {
			query = `SELECT * FROM ${this.tableName} WHERE owner_id = $owner_id AND parent_id = $parent_id ORDER BY name ASC`;
			params.parent_id = parentId;
		}

		const result = await this.db.query<[Folder[]]>(query, params);
		return (result[0] ?? []).map((record) => this.validate(record));
	}

	/**
	 * Find a folder by name and parent
	 */
	async findByNameAndParent(
		ownerId: RecordId,
		name: string,
		parentId: RecordId | null
	): Promise<Folder | null> {
		let query: string;
		const params: Record<string, unknown> = { owner_id: ownerId, name };

		if (parentId === null) {
			query = `SELECT * FROM ${this.tableName} WHERE owner_id = $owner_id AND name = $name AND parent_id IS NULL LIMIT 1`;
		} else {
			query = `SELECT * FROM ${this.tableName} WHERE owner_id = $owner_id AND name = $name AND parent_id = $parent_id LIMIT 1`;
			params.parent_id = parentId;
		}

		const result = await this.db.query<[Folder[]]>(query, params);
		const record = result[0]?.[0];
		if (!record) return null;
		return this.validate(record);
	}

	/**
	 * Get the full path of a folder by traversing up the parent chain
	 * Returns array of folder names from root to the specified folder
	 */
	async getFullPath(folderId: RecordId | string): Promise<string[]> {
		const recordId = typeof folderId === 'string' ? stringToRecordId.decode(folderId) : folderId;
		const path: string[] = [];
		let currentFolder = await this.findById(recordId);

		while (currentFolder) {
			path.unshift(currentFolder.name);
			if (currentFolder.parent_id) {
				currentFolder = await this.findById(currentFolder.parent_id);
			} else {
				break;
			}
		}

		return path;
	}

	/**
	 * Check if a folder or any of its ancestors is named "public"
	 * Any folder named "public" (at any level) makes its contents publicly accessible
	 */
	async isInPublicHierarchy(folderId: RecordId | string): Promise<boolean> {
		const recordId = typeof folderId === 'string' ? stringToRecordId.decode(folderId) : folderId;
		let currentFolder = await this.findById(recordId);

		while (currentFolder) {
			// Any folder named "public" (case-insensitive) makes contents public
			if (currentFolder.name.toLowerCase() === 'public') {
				return true;
			}
			if (currentFolder.parent_id) {
				currentFolder = await this.findById(currentFolder.parent_id);
			} else {
				break;
			}
		}

		return false;
	}

	/**
	 * Find or create a folder by name and parent
	 * Used for creating folder hierarchies (e.g., public/post_assets/post:123)
	 */
	async findOrCreate(ownerId: RecordId, name: string, parentId: RecordId | null): Promise<Folder> {
		const existing = await this.findByNameAndParent(ownerId, name, parentId);
		if (existing) {
			return existing;
		}

		const now = new Date();
		return this.create({
			name,
			owner_id: ownerId,
			parent_id: parentId,
			created_at: now,
			updated_at: now
		});
	}

	/**
	 * Create folder hierarchy from path array
	 * e.g., ['public', 'post_assets', 'post:123'] creates all folders if they don't exist
	 */
	async createHierarchy(ownerId: RecordId, pathParts: string[]): Promise<Folder | null> {
		if (pathParts.length === 0) return null;

		let parentId: RecordId | null = null;
		let lastFolder: Folder | null = null;

		for (const name of pathParts) {
			lastFolder = await this.findOrCreate(ownerId, name, parentId);
			parentId = lastFolder.id;
		}

		return lastFolder;
	}

	/**
	 * Get all descendant folder IDs (for deletion checks)
	 */
	async getDescendantIds(folderId: RecordId): Promise<RecordId[]> {
		const result = await this.db.query<[{ id: RecordId }[]]>(
			`SELECT id FROM ${this.tableName} WHERE parent_id = $folder_id`,
			{ folder_id: folderId }
		);

		const childIds = (result[0] ?? []).map((r) => r.id);
		const allDescendants: RecordId[] = [...childIds];

		for (const childId of childIds) {
			const grandchildren = await this.getDescendantIds(childId);
			allDescendants.push(...grandchildren);
		}

		return allDescendants;
	}
}

export const folderRepository = new FolderRepository();
