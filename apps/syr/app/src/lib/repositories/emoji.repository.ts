import { BaseRepository } from './base.repository';
import { EmojiSchema, type Emoji } from '@syr-is/types';

export class EmojiRepository extends BaseRepository<Emoji> {
	protected tableName = 'emoji';
	protected schema = EmojiSchema;

	async findByPackSlug(
		packSlug: string,
		opts: { limit?: number; offset?: number } = {}
	): Promise<{ data: Emoji[]; total: number }> {
		const limit = Math.min(Math.max(Math.floor(Number(opts.limit ?? 50)), 1), 200);
		const offset = Math.max(Math.floor(Number(opts.offset ?? 0)), 0);

		const [dataResult, countResult] = await Promise.all([
			this.db.query<[Emoji[]]>(
				`SELECT * FROM emoji WHERE pack_slug = $packSlug AND scope = 'instance' ORDER BY shortcode ASC LIMIT $limit START $offset`,
				{ packSlug, limit, offset }
			),
			this.db.query<[{ total: number }[]]>(
				`SELECT count() AS total FROM emoji WHERE pack_slug = $packSlug AND scope = 'instance' GROUP ALL`,
				{ packSlug }
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
	): Promise<{ data: Emoji[]; total: number }> {
		const limit = Math.min(Math.max(Math.floor(Number(opts.limit ?? 50)), 1), 200);
		const offset = Math.max(Math.floor(Number(opts.offset ?? 0)), 0);

		const [dataResult, countResult] = await Promise.all([
			this.db.query<[Emoji[]]>(
				`SELECT * FROM emoji WHERE id.created_by = $did AND scope = 'user' ORDER BY shortcode ASC LIMIT $limit START $offset`,
				{ did, limit, offset }
			),
			this.db.query<[{ total: number }[]]>(
				`SELECT count() AS total FROM emoji WHERE id.created_by = $did AND scope = 'user' GROUP ALL`,
				{ did }
			)
		]);

		const raw = dataResult[0] ?? [];
		const data = raw.map((r) => this.validate(r));
		const total = countResult[0]?.[0]?.total ?? 0;

		return { data, total };
	}

	async findInstanceEmojis(
		opts: { limit?: number; offset?: number } = {}
	): Promise<{ data: Emoji[]; total: number }> {
		const limit = Math.min(Math.max(Math.floor(Number(opts.limit ?? 1000)), 1), 1000);
		const offset = Math.max(Math.floor(Number(opts.offset ?? 0)), 0);

		const [dataResult, countResult] = await Promise.all([
			this.db.query<[Emoji[]]>(
				`SELECT * FROM emoji WHERE scope = 'instance' ORDER BY shortcode ASC LIMIT $limit START $offset`,
				{ limit, offset }
			),
			this.db.query<[{ total: number }[]]>(
				`SELECT count() AS total FROM emoji WHERE scope = 'instance' GROUP ALL`
			)
		]);

		const raw = dataResult[0] ?? [];
		const data = raw.map((r) => this.validate(r));
		const total = countResult[0]?.[0]?.total ?? 0;

		return { data, total };
	}
	/** Lightweight count + latest updated_at for a user's emojis. Used by the hash endpoint. */
	async digestByDid(did: string): Promise<{ count: number; latestUpdatedAt: string | null }> {
		const result = await this.db.query<[{ cnt: number; latest: string | null }[]]>(
			`SELECT count() AS cnt, math::max(updated_at) AS latest FROM emoji WHERE id.created_by = $did AND scope = 'user' GROUP ALL`,
			{ did }
		);
		const row = result[0]?.[0];
		return { count: row?.cnt ?? 0, latestUpdatedAt: row?.latest ?? null };
	}
}

export const emojiRepository = new EmojiRepository();
