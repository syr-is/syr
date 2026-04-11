import { BaseRepository } from './base.repository';
import { CommentSchema, type Comment } from '@syr-is/types';

export class CommentRepository extends BaseRepository<Comment> {
	protected tableName = 'comment';
	protected schema = CommentSchema;

	async findPublicByDid(
		did: string,
		opts: {
			postDid?: string;
			postId?: string;
			limit?: number;
			offset?: number;
		} = {}
	): Promise<{ data: Comment[]; total: number }> {
		const limit = Math.min(Math.max(Math.floor(Number(opts.limit ?? 50)), 1), 500);
		const offset = Math.max(Math.floor(Number(opts.offset ?? 0)), 0);

		let whereClause = `WHERE id.created_by = $did AND visibility = 'public' AND status = 'completed'`;
		const params: Record<string, unknown> = { did, limit, offset };

		if (opts.postDid && opts.postId) {
			whereClause += ` AND post_did = $postDid AND post_id = $postId`;
			params.postDid = opts.postDid;
			params.postId = opts.postId;
		}

		const [dataResult, countResult] = await Promise.all([
			this.db.query<[Comment[]]>(
				`SELECT * FROM comment ${whereClause} ORDER BY created_at ASC LIMIT $limit START $offset`,
				params
			),
			this.db.query<[{ total: number }[]]>(
				`SELECT count() AS total FROM comment ${whereClause} GROUP ALL`,
				{ ...params, limit: undefined, offset: undefined }
			)
		]);

		const raw = dataResult[0] ?? [];
		const data = raw.map((r) => this.validate(r));
		const total = countResult[0]?.[0]?.total ?? 0;

		return { data, total };
	}
}

export const commentRepository = new CommentRepository();
