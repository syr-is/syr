import { BaseRepository } from './base.repository';
import { PostSchema, type Post } from '@syr-is/types';

export class PostRepository extends BaseRepository<Post> {
	protected tableName = 'post';
	protected schema = PostSchema;

	/**
	 * Find all posts by DID (composite id.created_by).
	 * Used for export-bundle when author_id filter may not match.
	 */
	async findByDid(did: string): Promise<Post[]> {
		const result = await this.db.query<[Post[]]>(
			`SELECT * FROM post WHERE id.created_by = $did ORDER BY created_at DESC`,
			{ did }
		);
		const raw = result[0] ?? [];
		return raw.map((r) => this.validate(r));
	}
}

export const postRepository = new PostRepository();
