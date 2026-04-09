import { gifRepository } from '$lib/repositories/gif.repository';
import type { GifCreate, QueryOptions, User } from '@syr-is/types';
import type { RecordId } from 'surrealdb';

export class GifController {
	async createGif(user: User, data: GifCreate, opts?: { localId?: string }) {
		if (!user.did) {
			throw new Error('User must have an identity (DID) to create GIFs');
		}
		const now = new Date();
		const base = {
			...data,
			author_id: user.id,
			created_at: now,
			updated_at: now
		};
		if (opts?.localId) {
			return gifRepository.createWithExplicitId(user.did, opts.localId, base);
		}
		return gifRepository.createWithCompositeId(user.did, base);
	}

	async deleteGif(id: RecordId) {
		await gifRepository.delete(id);
	}

	async getUserGifs(userId: RecordId, opts: Partial<QueryOptions> = {}) {
		return gifRepository.findMany({
			...opts,
			filters: { author_id: userId, scope: 'user' }
		});
	}

	async getInstanceGifs(opts: { search?: string; limit?: number; offset?: number } = {}) {
		return gifRepository.findInstanceGifs(opts);
	}

	async getPublicGifsByDid(did: string, opts: { limit?: number; offset?: number } = {}) {
		return gifRepository.findPublicByDid(did, opts);
	}
}

export const gifController = new GifController();
