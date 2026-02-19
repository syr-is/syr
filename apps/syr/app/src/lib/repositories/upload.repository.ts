import { UploadSchema, type Upload } from '@syr-is/types';
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
	/** Cursor for next page: fetch uploads before this (created_at, id) */
	afterCreatedAt?: Date;
	afterId?: string;
}

export interface FindByDidResult {
	uploads: Upload[];
	/** Next cursor when more results exist; null when done */
	nextCursor: { afterCreatedAt: Date; afterId: string } | null;
}

export class UploadRepository extends BaseRepository<Upload> {
	protected tableName = 'upload';
	protected schema = UploadSchema;

	/**
	 * Find uploads by DID with offset-based pagination.
	 * Prefer findByDid for cursor-based pagination to avoid skip/duplicate under concurrent writes.
	 */
	async findByDidPage(did: string, options?: FindByDidPageOptions): Promise<FindByDidPageResult> {
		const limit = Math.max(1, Math.min(options?.limit ?? MAX_PAGE, MAX_PAGE));
		const offset = Math.max(0, options?.offset ?? 0);

		const result = await this.db.query<[Upload[]]>(
			`SELECT * FROM upload WHERE id.created_by = $did ORDER BY created_at DESC LIMIT $limit START $offset`,
			{ did, limit, offset }
		);
		const raw = result[0] ?? [];
		const uploads = raw.map((r) => this.validate(r));

		const nextCursor = uploads.length === limit ? { offset: offset + uploads.length } : null;

		return { uploads, nextCursor };
	}

	/**
	 * Find uploads by DID with cursor-based pagination.
	 * Uses composite cursor (created_at, id) to avoid dropping uploads with identical timestamps.
	 */
	async findByDid(did: string, options?: FindByDidOptions): Promise<FindByDidResult> {
		const limitNum = Math.floor(Math.max(1, Math.min(options?.limit ?? 500, MAX_PAGE)));
		const afterCreatedAt = options?.afterCreatedAt;
		const afterId = options?.afterId;

		let query: string;
		const params: Record<string, unknown> = { did };

		if (afterCreatedAt != null && afterId != null) {
			query = `SELECT * FROM upload
				WHERE id.created_by = $did AND (created_at < $afterCreatedAt OR (created_at = $afterCreatedAt AND id < $afterId))
				ORDER BY created_at DESC, id DESC
				LIMIT ${limitNum}`;
			params.afterCreatedAt = afterCreatedAt;
			params.afterId = afterId;
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
						afterId: typeof lastUpload.id === 'string' ? lastUpload.id : String(lastUpload.id)
					}
				: null;

		return { uploads, nextCursor };
	}
}

export const uploadRepository = new UploadRepository();
