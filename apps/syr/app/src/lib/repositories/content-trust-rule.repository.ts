import { dbService } from '$lib/services/db';
import type { RecordId } from 'surrealdb';
import type { TrustRuleKind } from '$lib/content-trust/matcher';

export interface UserContentTrustRule {
	id: RecordId;
	user_id: RecordId;
	pattern: string;
	kind: TrustRuleKind;
	sort_order: number;
	created_at: Date;
}

class ContentTrustRuleRepository {
	private get db() {
		return dbService.getDb();
	}

	async findByUserId(userId: RecordId | string): Promise<UserContentTrustRule[]> {
		const result = await this.db.query<[UserContentTrustRule[]]>(
			'SELECT * FROM user_content_trust_rule WHERE user_id = $userId ORDER BY sort_order ASC',
			{ userId }
		);
		const rows = result[0] ?? [];
		return rows.map((r) => ({
			...r,
			created_at: typeof r.created_at === 'string' ? new Date(r.created_at) : r.created_at
		}));
	}

	async replaceAllForUser(
		userId: RecordId | string,
		rules: Array<{ pattern: string; kind: TrustRuleKind }>
	): Promise<void> {
		await this.db.query('DELETE FROM user_content_trust_rule WHERE user_id = $userId', { userId });
		const now = new Date();
		for (let i = 0; i < rules.length; i++) {
			const r = rules[i];
			await this.db.query(
				`CREATE user_content_trust_rule SET
					user_id = $userId,
					pattern = $pattern,
					kind = $kind,
					sort_order = $sortOrder,
					created_at = $now`,
				{ userId, pattern: r.pattern.trim(), kind: r.kind, sortOrder: i, now }
			);
		}
	}

	async appendRule(userId: RecordId | string, pattern: string, kind: TrustRuleKind): Promise<void> {
		const existing = await this.findByUserId(userId);
		const nextOrder =
			existing.length === 0 ? 0 : Math.max(...existing.map((r) => r.sort_order)) + 1;
		const now = new Date();
		await this.db.query(
			`CREATE user_content_trust_rule SET
				user_id = $userId,
				pattern = $pattern,
				kind = $kind,
				sort_order = $nextOrder,
				created_at = $now`,
			{ userId, pattern: pattern.trim(), kind, nextOrder, now }
		);
	}

	async deleteAllForUser(userId: RecordId | string): Promise<void> {
		await this.db.query('DELETE FROM user_content_trust_rule WHERE user_id = $userId', { userId });
	}
}

export const contentTrustRuleRepository = new ContentTrustRuleRepository();
