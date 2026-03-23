import { BaseRepository } from './base.repository';
import {
	extractDid,
	extractLocalId,
	PostSchema,
	recordIdFromDidAndLocal,
	type Post
} from '@syr-is/types';

const MAX_LIMIT = 1000;
/** Cap public listing offset to avoid expensive full scans via huge START values */
const MAX_PUBLIC_OFFSET = 10_000;

export interface FindByDidOptions {
	/** Max posts per page (default: 500) */
	limit?: number;
	/** Cursor for next page: fetch posts before this (created_at, id). Both values required together. */
	cursor?: { afterCreatedAt: Date; afterDid: string; afterLocalId: string };
}

export interface FindByDidResult {
	posts: Post[];
	/** Next cursor when more results exist; null when done */
	nextCursor: { afterCreatedAt: Date; afterDid: string; afterLocalId: string } | null;
}

export class PostRepository extends BaseRepository<Post> {
	protected tableName = 'post';
	protected schema = PostSchema;

	/**
	 * Find posts by DID (composite id.created_by) with pagination.
	 * Used for export-bundle when author_id filter may not match.
	 * Call in a loop with nextCursor to fetch all posts for prolific DIDs.
	 * Uses composite cursor (created_at, id) to avoid dropping posts with identical timestamps.
	 */
	async findByDid(did: string, options?: FindByDidOptions): Promise<FindByDidResult> {
		const limitNum = Math.floor(Math.max(1, Math.min(options?.limit ?? 500, MAX_LIMIT)));
		const afterCreatedAt = options?.cursor?.afterCreatedAt;
		const afterDid = options?.cursor?.afterDid;
		const afterLocalId = options?.cursor?.afterLocalId;

		let query: string;
		const params: Record<string, unknown> = { did };

		if (afterCreatedAt != null && afterDid != null && afterLocalId != null) {
			query = `SELECT * FROM post
				WHERE id.created_by = $did AND (created_at < $afterCreatedAt OR (created_at = $afterCreatedAt AND id < $afterId))
				ORDER BY created_at DESC, id DESC
				LIMIT ${limitNum}`;
			params.afterCreatedAt = afterCreatedAt;
			params.afterId = recordIdFromDidAndLocal('post', afterDid, afterLocalId);
		} else {
			query = `SELECT * FROM post
				WHERE id.created_by = $did
				ORDER BY created_at DESC, id DESC
				LIMIT ${limitNum}`;
		}

		const result = await this.db.query<[Post[]]>(query, params);
		const raw = result[0] ?? [];
		const posts = raw.map((r) => this.validate(r));

		const lastPost = raw.length >= limitNum && posts.length > 0 ? posts[posts.length - 1]! : null;
		const nextCursor =
			lastPost != null
				? {
						afterCreatedAt: lastPost.created_at,
						afterDid: extractDid(lastPost.id),
						afterLocalId: extractLocalId(lastPost.id)
					}
				: null;

		return { posts, nextCursor };
	}

	/**
	 * Public posts for a DID (composite id.created_by), visibility = public only.
	 */
	async findPublicByDid(
		did: string,
		opts: { limit?: number; offset?: number } = {}
	): Promise<{ data: Post[]; total: number }> {
		const limitRaw = Number(opts.limit ?? 50);
		const offsetRaw = Number(opts.offset ?? 0);
		const limitNum = Number.isFinite(limitRaw) ? Math.floor(limitRaw) : NaN;
		const offsetNum = Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : NaN;
		if (Number.isNaN(limitNum) || Number.isNaN(offsetNum)) {
			throw new Error('findPublicByDid: limit and offset must be finite numbers');
		}
		const limit = Math.min(Math.max(limitNum, 1), 200);
		const offset = Math.min(Math.max(offsetNum, 0), MAX_PUBLIC_OFFSET);
		const dataResult = await this.db.query<[Post[]]>(
			`SELECT * FROM post
			 WHERE id.created_by = $did AND visibility = 'public' AND status = 'completed'
			 ORDER BY created_at DESC, id DESC
			 LIMIT $limit START $offset`,
			{ did, limit, offset }
		);
		const countResult = await this.db.query<[{ total: number }[]]>(
			`SELECT count() AS total FROM post
			 WHERE id.created_by = $did AND visibility = 'public' AND status = 'completed'
			 GROUP ALL`,
			{ did }
		);
		const raw = dataResult[0] ?? [];
		const data = raw.map((r) => this.validate(r));
		const total = countResult[0]?.[0]?.total ?? 0;
		return { data, total };
	}
}

export const postRepository = new PostRepository();
