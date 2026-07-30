import {
	extractDid,
	extractLocalId,
	recordIdFromDidAndLocal,
	stringToRecordId,
	UploadSchema,
	type Upload
} from '@syr-is/types';
import type { RecordId } from 'surrealdb';
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
	 * All story uploads owned by a DID — any status, any is_public flag.
	 * Used by the story-management UI to show active + expired + unpublished.
	 */
	async findAllStoriesByDid(did: string): Promise<Upload[]> {
		const result = await this.db.query<[Upload[]]>(
			`SELECT * FROM upload
			 WHERE id.created_by = $did
			   AND status = 'completed'
			   AND (
			     is_story = true
			     OR string::contains(type::string(key), '/stories/')
			   )
			 ORDER BY updated_at DESC`,
			{ did }
		);
		const raw = result[0] ?? [];
		const uploads = raw.map((r) => this.validate(r));
		// Prefer published_at for sort (actual publish time) and fall back to
		// updated_at. Sort in-memory so we don't need SurrealDB coalesce syntax.
		return uploads.sort((a, b) => {
			const at = (a.published_at ?? a.updated_at).getTime();
			const bt = (b.published_at ?? b.updated_at).getTime();
			return bt - at;
		});
	}

	/**
	 * Profile story slides for a DID within the rolling window.
	 * Prefers `is_story` + `published_at`; legacy rows use key path `/stories/` and `updated_at`.
	 */
	async findActiveStoriesByDid(did: string, since: Date): Promise<Upload[]> {
		const result = await this.db.query<[Upload[]]>(
			`SELECT * FROM upload
			 WHERE id.created_by = $did
			   AND is_public = true
			   AND status = 'completed'
			   AND url != NONE
			   AND key != NONE
			   AND (
			     (is_story = true AND published_at != NONE AND published_at >= $since)
			     OR (
			       string::contains(type::string(key), '/stories/')
			       AND updated_at >= $since
			       AND is_story IS NONE
			     )
			   )`,
			{ did, since }
		);
		const raw = result[0] ?? [];
		const uploads = raw.map((r) => this.validate(r));
		const effectiveTime = (u: Upload) => u.published_at?.getTime() ?? u.updated_at.getTime();
		return uploads.sort((a, b) => effectiveTime(a) - effectiveTime(b)).slice(0, 200);
	}

	/**
	 * Compare-and-set: pending → finalizing (quota not yet committed; not publicly "done").
	 */
	async casPendingToFinalizing(id: RecordId | string, now: Date): Promise<Upload | null> {
		const recordId = typeof id === 'string' ? stringToRecordId.decode(id) : id;
		const result = await this.db.query<[unknown[]]>(
			`UPDATE $id SET status = 'finalizing', updated_at = $now WHERE status = 'pending' RETURN AFTER`,
			{ id: recordId, now }
		);
		const row = result[0]?.[0];
		if (!row) {
			return null;
		}
		return this.validate(row);
	}

	/**
	 * Compare-and-set: finalizing → completed. Sets published_at once when is_story and published_at is NONE.
	 */
	async casFinalizingToCompleted(id: RecordId | string, now: Date): Promise<Upload | null> {
		const recordId = typeof id === 'string' ? stringToRecordId.decode(id) : id;
		const result = await this.db.query<[unknown[]]>(
			`UPDATE $id SET
				status = 'completed',
				updated_at = $now,
				published_at = IF is_story = true AND published_at IS NONE { $now } ELSE { published_at }
			 WHERE status = 'finalizing'
			 RETURN AFTER`,
			{ id: recordId, now }
		);
		const row = result[0]?.[0];
		if (!row) {
			return null;
		}
		return this.validate(row);
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

	/**
	 * Total bytes across a user's completed uploads, summed in the database.
	 * Replaces fetching + summing every upload in app memory. Uses idx_upload_owner.
	 */
	async sumCompletedSizeByOwner(ownerId: RecordId): Promise<number> {
		const result = await this.db.query<[{ total: number | null }[]]>(
			`SELECT math::sum(size) AS total FROM upload WHERE owner_id = $ownerId AND status = 'completed' GROUP ALL`,
			{ ownerId }
		);
		return result[0]?.[0]?.total ?? 0;
	}

	/**
	 * Find multiple uploads by their IDs
	 */
	async findByIds(ids: RecordId[]): Promise<Upload[]> {
		if (ids.length === 0) return [];
		const result = await this.db.query<[Upload[]]>(`SELECT * FROM $ids`, { ids });
		const raw = result[0] ?? [];
		const uploads: Upload[] = [];
		for (const r of raw) {
			// FROM $ids resolves each id against its own table, so re-assert the
			// scoping the old `FROM upload` query gave us for free.
			if (r?.id?.tb !== this.tableName) continue;
			try {
				uploads.push(this.validate(r));
			} catch {
				// Skip individual invalid records to prevent failing the batch
			}
		}
		return uploads;
	}
}

export const uploadRepository = new UploadRepository();
