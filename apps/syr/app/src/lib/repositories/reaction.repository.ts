import { BaseRepository } from './base.repository';
import { ReactionSchema, type Reaction } from '@syr-is/types';

export class ReactionRepository extends BaseRepository<Reaction> {
	protected tableName = 'reaction';
	protected schema = ReactionSchema;

	async findPublicByDid(
		did: string,
		opts: {
			parentType?: string;
			parentDid?: string;
			parentId?: string;
			limit?: number;
			offset?: number;
		} = {}
	): Promise<{ data: Reaction[]; total: number }> {
		const limit = Math.min(Math.max(Math.floor(Number(opts.limit ?? 50)), 1), 200);
		const offset = Math.max(Math.floor(Number(opts.offset ?? 0)), 0);

		let whereClause = `WHERE id.created_by = $did`;
		const params: Record<string, unknown> = { did, limit, offset };

		if (opts.parentType && opts.parentDid && opts.parentId) {
			whereClause += ` AND parent_type = $parentType AND parent_did = $parentDid AND parent_id = $parentId`;
			params.parentType = opts.parentType;
			params.parentDid = opts.parentDid;
			params.parentId = opts.parentId;
		}

		const [dataResult, countResult] = await Promise.all([
			this.db.query<[Reaction[]]>(
				`SELECT * FROM reaction ${whereClause} LIMIT $limit START $offset`,
				params
			),
			this.db.query<[{ total: number }[]]>(
				`SELECT count() AS total FROM reaction ${whereClause} GROUP ALL`,
				{ ...params, limit: undefined, offset: undefined }
			)
		]);

		const raw = dataResult[0] ?? [];
		const data = raw.map((r) => this.validate(r));
		const total = countResult[0]?.[0]?.total ?? 0;

		return { data, total };
	}

	async findExisting(
		did: string,
		parentType: string,
		parentDid: string,
		parentId: string,
		kind: string,
		value: string
	): Promise<Reaction | null> {
		const result = await this.db.query<[Reaction[]]>(
			`SELECT * FROM reaction
			 WHERE id.created_by = $did
			   AND parent_type = $parentType
			   AND parent_did = $parentDid
			   AND parent_id = $parentId
			   AND kind = $kind
			   AND value = $value
			 LIMIT 1`,
			{ did, parentType, parentDid, parentId, kind, value }
		);
		const record = result[0]?.[0];
		if (!record) return null;
		return this.validate(record);
	}
}

export const reactionRepository = new ReactionRepository();
