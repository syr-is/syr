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
		const now = new Date();
		let query =
			'BEGIN TRANSACTION;\nDELETE FROM user_content_trust_rule WHERE user_id = $userId;\n';
		const params: Record<string, unknown> = { userId, now };
		for (let i = 0; i < rules.length; i++) {
			const r = rules[i];
			query += `CREATE user_content_trust_rule SET user_id = $userId, pattern = $pattern${i}, kind = $kind${i}, sort_order = ${i}, created_at = $now;\n`;
			params[`pattern${i}`] = r.pattern.trim();
			params[`kind${i}`] = r.kind;
		}
		query += 'COMMIT TRANSACTION;';
		await this.db.query(query, params);
	}

	async appendRule(userId: RecordId | string, pattern: string, kind: TrustRuleKind): Promise<void> {
		const now = new Date();
		const p = pattern.trim();
		await this.db.query(
			`BEGIN TRANSACTION;
			 LET $top = SELECT sort_order FROM user_content_trust_rule WHERE user_id = $userId ORDER BY sort_order DESC LIMIT 1;
			 LET $next = IF array::len($top) = 0 { 0 } ELSE { $top[0].sort_order + 1 };
			 CREATE user_content_trust_rule SET user_id = $userId, pattern = $pattern, kind = $kind, sort_order = $next, created_at = $now;
			 COMMIT TRANSACTION;`,
			{ userId, pattern: p, kind, now }
		);
	}

	async deleteAllForUser(userId: RecordId | string): Promise<void> {
		await this.db.query('DELETE FROM user_content_trust_rule WHERE user_id = $userId', { userId });
	}
}

export const contentTrustRuleRepository = new ContentTrustRuleRepository();
