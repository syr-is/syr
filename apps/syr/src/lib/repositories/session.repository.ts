import { BaseRepository } from './base.repository';
import { SessionSchema, stringToRecordId, type Session } from '@syr-is/types';
import type { RecordId } from 'surrealdb';

/**
 * Session Repository
 * Handles CRUD operations for user sessions
 */
export class SessionRepository extends BaseRepository<Session> {
	protected tableName = 'session';
	protected schema = SessionSchema;

	/**
	 * Find session by token
	 */
	async findByToken(token: string): Promise<Session | null> {
		return this.findOne({ token } as Partial<Session>);
	}

	/**
	 * Find all sessions for a user
	 */
	async findByUserId(userId: RecordId | string): Promise<Session[]> {
		const userRecordId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
		const result = await this.db.query<[Session[]]>(
			`SELECT * FROM ${this.tableName} WHERE user_id = $userRecordId`,
			{ userRecordId }
		);
		return result[0] ?? [];
	}

	/**
	 * Delete expired sessions
	 */
	async deleteExpired(): Promise<void> {
		const now = new Date().toISOString();
		await this.db.query(`DELETE FROM ${this.tableName} WHERE expires_at < $now`, { now });
	}

	/**
	 * Delete all sessions for a user (logout all devices)
	 */
	async deleteByUserId(userId: RecordId | string): Promise<void> {
		const userRecordId = typeof userId === 'string' ? stringToRecordId.decode(userId) : userId;
		await this.db.query(`DELETE FROM ${this.tableName} WHERE user_id = $userRecordId`, {
			userRecordId
		});
	}
}

// Export singleton instance
export const sessionRepository = new SessionRepository();
