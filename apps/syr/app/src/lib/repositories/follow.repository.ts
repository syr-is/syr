import { dbService } from '$lib/services/db';
import { stringToRecordId } from '@syr-is/types';
import type { RecordId } from 'surrealdb';

export interface UserFollow {
	id: RecordId;
	follower_user_id: RecordId;
	followed_did: string;
	source_registry?: string;
	created_at: Date;
}

export class FollowRepository {
	private get db() {
		return dbService.getDb();
	}

	private isUniqueConstraintError(error: unknown): boolean {
		if (error && typeof error === 'object') {
			const o = error as { code?: unknown; errno?: unknown; message?: unknown };
			const codeStr = o.code !== undefined ? String(o.code) : '';
			if (codeStr === 'UNIQUE_CONSTRAINT_VIOLATION') return true;
			if (codeStr === '23505') return true;
			if (typeof o.errno === 'number' && o.errno === 19) return true;

			if (typeof o.message === 'string') {
				const msg = o.message.toLowerCase();
				return (
					/\bduplicate key\b/.test(msg) ||
					/\bunique constraint\b/.test(msg) ||
					/\balready exists\b/.test(msg) ||
					/\bduplicate entry\b/.test(msg)
				);
			}
		}
		return false;
	}

	async createFollow(
		followerUserId: RecordId | string,
		followedDid: string,
		sourceRegistry?: string
	): Promise<UserFollow> {
		const uid =
			typeof followerUserId === 'string' ? stringToRecordId.decode(followerUserId) : followerUserId;
		const now = new Date();
		let result: unknown;
		try {
			result = await this.db.create('user_follow', {
				follower_user_id: uid,
				followed_did: followedDid,
				source_registry: sourceRegistry,
				created_at: now
			});
		} catch (e) {
			if (!this.isUniqueConstraintError(e)) throw e;
			const existing = await this.findOne(uid, followedDid);
			if (existing) return existing;
			throw e;
		}
		const row = Array.isArray(result) ? result[0] : result;
		if (
			!row ||
			typeof row !== 'object' ||
			!('id' in row) ||
			!('followed_did' in row) ||
			!('follower_user_id' in row) ||
			!('created_at' in row)
		) {
			throw new Error('createFollow: unexpected database response');
		}
		return row as unknown as UserFollow;
	}

	async deleteFollow(followerUserId: RecordId | string, followedDid: string): Promise<void> {
		const uid =
			typeof followerUserId === 'string' ? stringToRecordId.decode(followerUserId) : followerUserId;
		await this.db.query(
			`DELETE FROM user_follow WHERE follower_user_id = $uid AND followed_did = $did`,
			{ uid, did: followedDid }
		);
	}

	async findByFollower(followerUserId: RecordId | string): Promise<UserFollow[]> {
		const uid =
			typeof followerUserId === 'string' ? stringToRecordId.decode(followerUserId) : followerUserId;
		const result = await this.db.query<[UserFollow[]]>(
			`SELECT * FROM user_follow WHERE follower_user_id = $uid ORDER BY created_at DESC`,
			{ uid }
		);
		return (result[0] ?? []) as UserFollow[];
	}

	async findOne(
		followerUserId: RecordId | string,
		followedDid: string
	): Promise<UserFollow | null> {
		const uid =
			typeof followerUserId === 'string' ? stringToRecordId.decode(followerUserId) : followerUserId;
		const result = await this.db.query<[UserFollow[]]>(
			`SELECT * FROM user_follow WHERE follower_user_id = $uid AND followed_did = $did LIMIT 1`,
			{ uid, did: followedDid }
		);
		return (result[0]?.[0] as UserFollow | undefined) ?? null;
	}
}

export const followRepository = new FollowRepository();
