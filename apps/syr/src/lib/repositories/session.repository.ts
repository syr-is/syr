import { BaseRepository } from './base.repository';
import { SessionSchema, type Session } from '@syr-is/types';

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
	async findByUserId(userId: string): Promise<Session[]> {
		const result = await this.findMany({
			filters: { user_id: userId }
		});
		return result.data;
	}

	/**
	 * Delete expired sessions
	 */
	async deleteExpired(): Promise<void> {
		const now = new Date().toISOString();
		await this.db.query(
			`DELETE FROM ${this.tableName} WHERE expires_at < $now`,
			{ now }
		);
	}

	/**
	 * Delete all sessions for a user (logout all devices)
	 */
	async deleteByUserId(userId: string): Promise<void> {
		await this.db.query(
			`DELETE FROM ${this.tableName} WHERE user_id = $userId`,
			{ userId }
		);
	}
}

// Export singleton instance
export const sessionRepository = new SessionRepository();

