import { dbService } from '$lib/services/db';
import type { RecordId } from 'surrealdb';
import type { TrustRuleKind } from '$lib/content-trust/matcher';

const CONTENT_TRUST_RULE_MAX = 200;

/** Thrown when the per-user rule cap is hit inside {@link ContentTrustRuleRepository.appendRuleWithLimit}. */
export class ContentTrustRuleLimitExceededError extends Error {
	readonly code = 'CONTENT_TRUST_LIMIT';
	constructor(maxRules: number) {
		super(`Content trust rules are limited to ${maxRules} entries`);
		this.name = 'ContentTrustRuleLimitExceededError';
	}
}

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
		if (rules.length > CONTENT_TRUST_RULE_MAX) {
			throw new ContentTrustRuleLimitExceededError(CONTENT_TRUST_RULE_MAX);
		}
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
		await this.appendRuleWithLimit(userId, pattern, kind, CONTENT_TRUST_RULE_MAX);
	}

	/**
	 * Append one rule after verifying the per-user count in the same transaction (avoids TOCTOU vs separate SELECT).
	 */
	async appendRuleWithLimit(
		userId: RecordId | string,
		pattern: string,
		kind: TrustRuleKind,
		maxRules: number = CONTENT_TRUST_RULE_MAX
	): Promise<void> {
		const now = new Date();
		const p = pattern.trim();
		try {
			await this.db.query(
				`BEGIN TRANSACTION;
				 LET $cntRow = SELECT count() AS count FROM user_content_trust_rule WHERE user_id = $userId GROUP ALL;
				 LET $count = IF array::len($cntRow) = 0 { 0 } ELSE { $cntRow[0].count };
				 IF $count >= $maxRules {
					 THROW "CONTENT_TRUST_LIMIT";
				 };
				 LET $top = SELECT sort_order FROM user_content_trust_rule WHERE user_id = $userId ORDER BY sort_order DESC LIMIT 1;
				 LET $next = IF array::len($top) = 0 { 0 } ELSE { $top[0].sort_order + 1 };
				 CREATE user_content_trust_rule SET user_id = $userId, pattern = $pattern, kind = $kind, sort_order = $next, created_at = $now;
				 COMMIT TRANSACTION;`,
				{ userId, pattern: p, kind, now, maxRules }
			);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (msg.includes('CONTENT_TRUST_LIMIT')) {
				throw new ContentTrustRuleLimitExceededError(maxRules);
			}
			throw e;
		}
	}

	async deleteAllForUser(userId: RecordId | string): Promise<void> {
		await this.db.query('DELETE FROM user_content_trust_rule WHERE user_id = $userId', { userId });
	}
}

export const contentTrustRuleRepository = new ContentTrustRuleRepository();
