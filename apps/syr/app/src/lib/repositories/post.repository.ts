import { BaseRepository } from './base.repository';
import { PostSchema, type Post } from '@syr-is/types';

const MAX_LIMIT = 1000;

export interface FindByDidOptions {
	/** Max posts per page (default: 500) */
	limit?: number;
	/** Cursor for next page: fetch posts before this (created_at, id) */
	afterCreatedAt?: Date;
	afterId?: string;
}

export interface FindByDidResult {
	posts: Post[];
	/** Next cursor when more results exist; null when done */
	nextCursor: { afterCreatedAt: Date; afterId: string } | null;
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
		const afterCreatedAt = options?.afterCreatedAt;
		const afterId = options?.afterId;

		let query: string;
		const params: Record<string, unknown> = { did };

		if (afterCreatedAt != null && afterId != null) {
			query = `SELECT * FROM post
				WHERE id.created_by = $did AND (created_at < $afterCreatedAt OR (created_at = $afterCreatedAt AND id < $afterId))
				ORDER BY created_at DESC, id DESC
				LIMIT ${limitNum}`;
			params.afterCreatedAt = afterCreatedAt;
			params.afterId = afterId;
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
						afterId: typeof lastPost.id === 'string' ? lastPost.id : String(lastPost.id)
					}
				: null;

		return { posts, nextCursor };
	}
}

export const postRepository = new PostRepository();
