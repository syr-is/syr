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

export class UploadRepository extends BaseRepository<Upload> {
	protected tableName = 'upload';
	protected schema = UploadSchema;

	/**
	 * Find all uploads by DID (composite id.created_by).
	 * Used for export-bundle when owner_id filter may not match.
	 */
	async findByDid(did: string): Promise<Upload[]> {
		const result = await this.db.query<[Upload[]]>(
			`SELECT * FROM upload WHERE id.created_by = $did ORDER BY created_at DESC`,
			{ did }
		);
		const raw = result[0] ?? [];
		return raw.map((r) => this.validate(r));
	}

	/**
	 * Find uploads by DID with pagination.
	 * Call in a loop with nextCursor to fetch all uploads for prolific DIDs.
	 * Used for export-bundle to avoid loading unbounded results into memory.
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
}

export const uploadRepository = new UploadRepository();
