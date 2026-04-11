import { emojiRepository } from '$lib/repositories/emoji.repository';
import { type EmojiCreate, type QueryOptions, type User } from '@syr-is/types';
import type { RecordId } from 'surrealdb';

export class EmojiController {
	async createEmoji(user: User, data: EmojiCreate, opts?: { localId?: string }) {
		if (!user.did) {
			throw new Error('User must have an identity (DID) to create emojis');
		}
		const now = new Date();
		const base = {
			...data,
			author_id: user.id,
			created_at: now,
			updated_at: now
		};
		if (opts?.localId) {
			return emojiRepository.createWithExplicitId(user.did, opts.localId, base);
		}
		return emojiRepository.createWithCompositeId(user.did, base);
	}

	async deleteEmoji(id: RecordId) {
		await emojiRepository.delete(id);
	}

	async getUserEmojis(userId: RecordId, opts: Partial<QueryOptions> = {}) {
		return emojiRepository.findMany({
			...opts,
			filters: { author_id: userId, scope: 'user' }
		});
	}

	async getPublicEmojisByDid(did: string, opts: { limit?: number; offset?: number } = {}) {
		return emojiRepository.findPublicByDid(did, opts);
	}

	async getInstanceCatalog() {
		return emojiRepository.findInstanceEmojis({ limit: 1000, offset: 0 });
	}
}

export const emojiController = new EmojiController();
