import { postRepository } from '$lib/repositories/post.repository';
import {
	recordIdFromDidAndLocal,
	type PostCreate,
	type PostUpdate,
	type QueryOptions,
	type User,
	type Post
} from '@syr-is/types';
import type { RecordId } from 'surrealdb';

export type PostSignatureStorage = {
	content_signature: string;
	signed_payload_json: string;
	signing_device_public_key: string;
};

export class PostController {
	async createPost(
		user: User,
		post: PostCreate,
		opts?: { localId?: string; createdAt?: Date; signature?: PostSignatureStorage }
	) {
		if (!user.did) {
			throw new Error('User must have an identity (DID) to create posts');
		}
		const createdAt = opts?.createdAt ?? new Date();
		const base = {
			...post,
			author_id: user.id,
			created_at: createdAt,
			updated_at: createdAt,
			...(opts?.signature ?? {})
		};
		if (opts?.localId) {
			return postRepository.createWithExplicitId(user.did, opts.localId, base);
		}
		return postRepository.createWithCompositeId(user.did, base);
	}
	async updatePost(post: PostUpdate, keysToUnset?: string[], signature?: PostSignatureStorage) {
		const payload = { ...post, updated_at: new Date(), ...(signature ?? {}) };
		const updatedPost =
			(keysToUnset?.length ?? 0) > 0
				? await postRepository.updateWithUnset(post.id, payload, keysToUnset!)
				: await postRepository.update(post.id, payload);
		return updatedPost;
	}
	async deletePost(id: RecordId, _ownerId: RecordId) {
		// Only delete the post record. Associated uploads remain in the
		// user's storage and can be managed independently via the uploads page.
		await postRepository.delete(id);
	}
	async getPost(id: RecordId) {
		const post = await postRepository.findById(id);
		return post;
	}
	async getUserPosts(
		userId: RecordId,
		options: Partial<QueryOptions> = {
			sort: { field: 'created_at', order: 'desc' }
		}
	) {
		const posts = await postRepository.findMany({
			...options,
			filters: { author_id: userId }
		});
		return posts;
	}

	async getPublicPostsByDid(did: string, limit?: number, offset?: number) {
		return postRepository.findPublicByDid(did, { limit, offset });
	}

	async getPublicPost(did: string, localId: string): Promise<Post | null> {
		const id = recordIdFromDidAndLocal('post', did, localId);
		const post = await postRepository.findById(id);
		if (!post || post.visibility !== 'public' || post.status !== 'completed') return null;
		return post;
	}
}

export const postController = new PostController();
