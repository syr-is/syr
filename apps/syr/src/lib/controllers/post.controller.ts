import { postRepository } from '$lib/repositories/post.repository';
import type { PostCreate, PostUpdate, QueryOptions, User } from '@syr-is/types';
import type { RecordId } from 'surrealdb';

export class PostController {
	async createPost(user: User, post: PostCreate) {
		const newPost = await postRepository.create({
			...post,
			author_id: user.id,
			created_at: new Date(),
			updated_at: new Date()
		});
		return newPost;
	}
	async updatePost(post: PostUpdate, keysToUnset?: string[]) {
		const payload = { ...post, updated_at: new Date() };
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
}

export const postController = new PostController();
