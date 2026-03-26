import {
	extractDid,
	extractLocalId,
	recordIdFromDidAndLocal,
	UploadSchema,
	type Upload
} from '@syr-is/types';
import { BaseRepository } from './base.repository';
const MAX_PAGE = 500;

export interface FindByDidPageOptions {
	limit?: number;
	offset?: number;
}

export interface FindByDidPageResult {
	uploads: Upload[];
	nextCursor: { offset: number } | null;
}

export interface FindByDidOptions {
	/** Max uploads per page (default: 500) */
	limit?: number;
	/** Cursor for next page: fetch uploads before this (created_at, id). Both values required together. */
	cursor?: { afterCreatedAt: Date; afterDid: string; afterLocalId: string };
}

export interface FindByDidResult {
	uploads: Upload[];
	/** Next cursor when more results exist; null when done */
	nextCursor: { afterCreatedAt: Date; afterDid: string; afterLocalId: string } | null;
}

export class UploadRepository extends BaseRepository<Upload> {
	protected tableName = 'upload';
	protected schema = UploadSchema;

	/**
	 * Find uploads by DID with offset-based pagination.
	 * Prefer findByDid for cursor-based pagination to avoid skip/duplicate under concurrent writes.
	 */
	async findByDidPage(did: string, options?: FindByDidPageOptions): Promise<FindByDidPageResult> {
		const limitNum = Math.floor(Math.max(1, Math.min(options?.limit ?? MAX_PAGE, MAX_PAGE)));
		const offsetNum = Math.floor(Math.max(0, options?.offset ?? 0));

		const result = await this.db.query<[Upload[]]>(
			`SELECT * FROM upload WHERE id.created_by = $did ORDER BY created_at DESC LIMIT ${limitNum} START ${offsetNum}`,
			{ did }
		);
		const raw = result[0] ?? [];
		const uploads = raw.map((r) => this.validate(r));

		const nextCursor = uploads.length === limitNum ? { offset: offsetNum + uploads.length } : null;

		return { uploads, nextCursor };
	}

	/**
	 * Find uploads by DID with cursor-based pagination.
	 * Uses composite cursor (created_at, id) to avoid dropping uploads with identical timestamps.
	 */
	async findByDid(did: string, options?: FindByDidOptions): Promise<FindByDidResult> {
		const limitNum = Math.floor(Math.max(1, Math.min(options?.limit ?? MAX_PAGE, MAX_PAGE)));
		const afterCreatedAt = options?.cursor?.afterCreatedAt;
		const afterDid = options?.cursor?.afterDid;
		const afterLocalId = options?.cursor?.afterLocalId;

		let query: string;
		const params: Record<string, unknown> = { did };

		if (afterCreatedAt != null && afterDid != null && afterLocalId != null) {
			query = `SELECT * FROM upload
				WHERE id.created_by = $did AND (created_at < $afterCreatedAt OR (created_at = $afterCreatedAt AND id < $afterId))
				ORDER BY created_at DESC, id DESC
				LIMIT ${limitNum}`;
			params.afterCreatedAt = afterCreatedAt;
			params.afterId = recordIdFromDidAndLocal('upload', afterDid, afterLocalId);
		} else {
			query = `SELECT * FROM upload
				WHERE id.created_by = $did
				ORDER BY created_at DESC, id DESC
				LIMIT ${limitNum}`;
		}

		const result = await this.db.query<[Upload[]]>(query, params);
		const raw = result[0] ?? [];
		const uploads = raw.map((r) => this.validate(r));

		const lastUpload =
			raw.length >= limitNum && uploads.length > 0 ? uploads[uploads.length - 1]! : null;
		const nextCursor =
			lastUpload != null
				? {
						afterCreatedAt: lastUpload.created_at,
						afterDid: extractDid(lastUpload.id),
						afterLocalId: extractLocalId(lastUpload.id)
					}
				: null;

		return { uploads, nextCursor };
	}

	/**
	 * Public uploads for a DID: completed, marked public, with a URL (for directory / profile pages).
	 */
	async findPublicByDidPage(
		did: string,
		options?: FindByDidPageOptions
	): Promise<FindByDidPageResult> {
		const limitNum = Math.floor(Math.max(1, Math.min(options?.limit ?? MAX_PAGE, MAX_PAGE)));
		const offsetNum = Math.floor(Math.max(0, options?.offset ?? 0));

		const result = await this.db.query<[Upload[]]>(
			`SELECT * FROM upload
			 WHERE id.created_by = $did AND is_public = true AND status = 'completed' AND url != NONE
			 ORDER BY created_at DESC LIMIT ${limitNum} START ${offsetNum}`,
			{ did }
		);
		const raw = result[0] ?? [];
		const uploads = raw.map((r) => this.validate(r));

		const nextCursor = uploads.length === limitNum ? { offset: offsetNum + uploads.length } : null;

		return { uploads, nextCursor };
	}

	/**
	 * Profile story slides for a DID within the rolling window (by completion time `updated_at`).
	 * Keys live under `uploads/{did}/stories/{UTC date}/public/…`.
	 */
	async findActiveStoriesByDid(did: string, since: Date): Promise<Upload[]> {
		const result = await this.db.query<[Upload[]]>(
			`SELECT * FROM upload
			 WHERE id.created_by = $did
			   AND is_public = true
			   AND status = 'completed'
			   AND url != NONE
			   AND key != NONE
			   AND updated_at >= $since
			 ORDER BY updated_at ASC
			 LIMIT 200`,
			{ did, since }
		);
		const raw = result[0] ?? [];
		return raw
			.map((r) => this.validate(r))
			.filter((u) => typeof u.key === 'string' && u.key.includes('/stories/'));
	}

	/** Count public completed uploads with URL for a DID (pagination totals). */
	async countPublicByDid(did: string): Promise<number> {
		const countResult = await this.db.query<[{ total: number }[]]>(
			`SELECT count() AS total FROM upload
			 WHERE id.created_by = $did AND is_public = true AND status = 'completed' AND url != NONE
			 GROUP ALL`,
			{ did }
		);
		return countResult[0]?.[0]?.total ?? 0;
	}

	/**
	 * Find an upload by composite ID (did + localId).
	 * Used for profile asset upsert (profile-avatar, profile-banner).
	 */
	async findByCompositeId(did: string, localId: string): Promise<Upload | null> {
		const recordId = recordIdFromDidAndLocal(this.tableName, did, localId);
		return this.findById(recordId);
	}
}

export const uploadRepository = new UploadRepository();
