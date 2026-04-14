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
	/** Lightweight count + latest updated_at for a user's GIFs. Used by the hash endpoint. */
	async digestByDid(did: string): Promise<{ count: number; latestUpdatedAt: string | null }> {
		const result = await this.db.query<[{ cnt: number; latest: string | null }[]]>(
			`SELECT count() AS cnt, math::max(updated_at) AS latest FROM gif WHERE id.created_by = $did AND scope = 'user' GROUP ALL`,
			{ did }
		);
		const row = result[0]?.[0];
		return { count: row?.cnt ?? 0, latestUpdatedAt: row?.latest ?? null };
	}
}

export const gifRepository = new GifRepository();
