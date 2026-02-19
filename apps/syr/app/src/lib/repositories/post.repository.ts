import { BaseRepository } from './base.repository';
import { PostSchema, type Post } from '@syr-is/types';

export interface FindByDidOptions {
	/** Max posts per page (default: 500) */
	limit?: number;
	/** Cursor for next page: fetch posts with created_at < this value */
	afterCreatedAt?: Date;
}

export interface FindByDidResult {
	posts: Post[];
	/** Next cursor (last post's created_at) when more results exist; null when done */
	nextCursor: Date | null;
}

export class PostRepository extends BaseRepository<Post> {
	protected tableName = 'post';
	protected schema = PostSchema;

	/**
	 * Find posts by DID (composite id.created_by) with pagination.
	 * Used for export-bundle when author_id filter may not match.
	 * Call in a loop with nextCursor to fetch all posts for prolific DIDs.
	 */
	async findByDid(did: string, options?: FindByDidOptions): Promise<FindByDidResult> {
		const limit = options?.limit ?? 500;
		const afterCreatedAt = options?.afterCreatedAt;

		let query: string;
		const params: Record<string, unknown> = { did, limit };

		if (afterCreatedAt) {
			query = `SELECT * FROM post
				WHERE id.created_by = $did AND created_at < $afterCreatedAt
				ORDER BY created_at DESC
				LIMIT $limit`;
			params.afterCreatedAt = afterCreatedAt;
		} else {
			query = `SELECT * FROM post
				WHERE id.created_by = $did
				ORDER BY created_at DESC
				LIMIT $limit`;
		}

		const result = await this.db.query<[Post[]]>(query, params);
		const raw = result[0] ?? [];
		const posts = raw.map((r) => this.validate(r));

		const nextCursor =
			raw.length >= limit && posts.length > 0 ? posts[posts.length - 1]!.created_at : null;

		return { posts, nextCursor };
	}
}

export const postRepository = new PostRepository();
