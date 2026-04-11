import { BaseRepository } from './base.repository';
import { EmojiPackSchema, type EmojiPack } from '@syr-is/types';

export class EmojiPackRepository extends BaseRepository<EmojiPack> {
	protected tableName = 'emoji_pack';
	protected schema = EmojiPackSchema;

	async findBySlug(slug: string): Promise<EmojiPack | null> {
		const result = await this.db.query<[EmojiPack[]]>(
			`SELECT * FROM emoji_pack WHERE slug = $slug LIMIT 1`,
			{ slug }
		);
		const record = result[0]?.[0];
		if (!record) return null;
		return this.validate(record);
	}

	async findAll(
		opts: { limit?: number; offset?: number } = {}
	): Promise<{ data: EmojiPack[]; total: number }> {
		const limit = Math.min(Math.max(Math.floor(Number(opts.limit ?? 50)), 1), 200);
		const offset = Math.max(Math.floor(Number(opts.offset ?? 0)), 0);

		const [dataResult, countResult] = await Promise.all([
			this.db.query<[EmojiPack[]]>(
				`SELECT * FROM emoji_pack ORDER BY name ASC LIMIT $limit START $offset`,
				{ limit, offset }
			),
			this.db.query<[{ total: number }[]]>(`SELECT count() AS total FROM emoji_pack GROUP ALL`)
		]);

		const raw = dataResult[0] ?? [];
		const data = raw.map((r) => this.validate(r));
		const total = countResult[0]?.[0]?.total ?? 0;

		return { data, total };
	}
}

export const emojiPackRepository = new EmojiPackRepository();
