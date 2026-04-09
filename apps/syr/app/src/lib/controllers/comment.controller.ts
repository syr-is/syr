import { commentRepository } from '$lib/repositories/comment.repository';
import {
	recordIdFromDidAndLocal,
	type CommentCreate,
	type QueryOptions,
	type User,
	type Comment
} from '@syr-is/types';
import type { RecordId } from 'surrealdb';

export type CommentSignatureStorage = {
	content_signature: string;
	signed_payload_json: string;
	signing_device_public_key: string;
};

export class CommentController {
	async createComment(
		user: User,
		data: CommentCreate,
		opts?: { localId?: string; signature?: CommentSignatureStorage }
	) {
		if (!user.did) {
			throw new Error('User must have an identity (DID) to create comments');
		}
		const now = new Date();
		const base = {
			...data,
			author_id: user.id,
			created_at: now,
			updated_at: now,
			...(opts?.signature ?? {})
		};
		if (opts?.localId) {
			return commentRepository.createWithExplicitId(user.did, opts.localId, base);
		}
		return commentRepository.createWithCompositeId(user.did, base);
	}

	async updateComment(
		id: RecordId,
		data: Partial<CommentCreate>,
		signature?: CommentSignatureStorage
	) {
		return commentRepository.update(id, {
			...data,
			updated_at: new Date(),
			...(signature ?? {})
		});
	}

	async deleteComment(id: RecordId) {
		await commentRepository.delete(id);
	}

	async getComment(id: RecordId) {
		return commentRepository.findById(id);
	}

	async getUserComments(userId: RecordId, opts: Partial<QueryOptions> = {}) {
		return commentRepository.findMany({
			...opts,
			filters: { author_id: userId }
		});
	}

	async getPublicCommentsByDid(
		did: string,
		opts: {
			parentType?: string;
			parentDid?: string;
			parentId?: string;
			postDid?: string;
			postId?: string;
			limit?: number;
			offset?: number;
		} = {}
	) {
		return commentRepository.findPublicByDid(did, opts);
	}

	async getPublicComment(did: string, localId: string): Promise<Comment | null> {
		const id = recordIdFromDidAndLocal('comment', did, localId);
		const comment = await commentRepository.findById(id);
		if (!comment || comment.visibility !== 'public' || comment.status !== 'completed') return null;
		return comment;
	}
}

export const commentController = new CommentController();
