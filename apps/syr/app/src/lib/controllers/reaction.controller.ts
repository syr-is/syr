import { reactionRepository } from '$lib/repositories/reaction.repository';
import type { ReactionCreate, User } from '@syr-is/types';
import type { RecordId } from 'surrealdb';

export class ReactionController {
	async toggleReaction(user: User, data: ReactionCreate) {
		if (!user.did) {
			throw new Error('User must have an identity (DID) to react');
		}
		const existing = await reactionRepository.findExisting(
			user.did,
			data.parent_type,
			data.parent_did,
			data.parent_id,
			data.kind,
			data.value
		);
		if (existing) {
			await reactionRepository.delete(existing.id);
			return { reaction: null, action: 'removed' as const };
		}
		const now = new Date();
		const reaction = await reactionRepository.createWithCompositeId(user.did, {
			...data,
			author_id: user.id,
			created_at: now,
			updated_at: now
		});
		return { reaction, action: 'created' as const };
	}

	async deleteReaction(id: RecordId) {
		await reactionRepository.delete(id);
	}

	async getPublicReactionsByDid(
		did: string,
		opts: {
			parentType?: string;
			parentDid?: string;
			parentId?: string;
			limit?: number;
			offset?: number;
		} = {}
	) {
		return reactionRepository.findPublicByDid(did, opts);
	}
}

export const reactionController = new ReactionController();
