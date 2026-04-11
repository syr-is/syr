import { BaseRepository } from './base.repository';
import { GifSchema, type Gif } from '@syr-is/types';

export class GifRepository extends BaseRepository<Gif> {
	protected tableName = 'gif';
	protected schema = GifSchema;

	async findInstanceGifs(
		opts: { search?: string; limit?: number; offset?: number } = {}
	): Promise<{ data: Gif[]; total: number }> {
		const limit = Math.min(Math.max(Math.floor(Number(opts.limit ?? 50)), 1), 200);
		const offset = Math.max(Math.floor(Number(opts.offset ?? 0)), 0);
		const search = opts.search;

		const whereClause = search
			? `WHERE scope = 'instance' AND tags CONTAINS $search`
			: `WHERE scope = 'instance'`;
		const params: Record<string, unknown> = search ? { search, limit, offset } : { limit, offset };

		const [dataResult, countResult] = await Promise.all([
			this.db.query<[Gif[]]>(`SELECT * FROM gif ${whereClause} LIMIT $limit START $offset`, params),
			this.db.query<[{ total: number }[]]>(
				`SELECT count() AS total FROM gif ${whereClause} GROUP ALL`,
				search ? { search } : {}
			)
		]);

		const raw = dataResult[0] ?? [];
		const data = raw.map((r) => this.validate(r));
		const total = countResult[0]?.[0]?.total ?? 0;

		return { data, total };
	}

	async findPublicByDid(
		did: string,
		opts: { limit?: number; offset?: number } = {}
	): Promise<{ data: Gif[]; total: number }> {
		const limit = Math.min(Math.max(Math.floor(Number(opts.limit ?? 50)), 1), 200);
		const offset = Math.max(Math.floor(Number(opts.offset ?? 0)), 0);

		const [dataResult, countResult] = await Promise.all([
			this.db.query<[Gif[]]>(
				`SELECT * FROM gif WHERE id.created_by = $did AND scope = 'user' LIMIT $limit START $offset`,
				{ did, limit, offset }
			),
			this.db.query<[{ total: number }[]]>(
				`SELECT count() AS total FROM gif WHERE id.created_by = $did AND scope = 'user' GROUP ALL`,
				{ did }
			)
		]);

		const raw = dataResult[0] ?? [];
		const data = raw.map((r) => this.validate(r));
		const total = countResult[0]?.[0]?.total ?? 0;

		return { data, total };
	}
}

export const gifRepository = new GifRepository();
