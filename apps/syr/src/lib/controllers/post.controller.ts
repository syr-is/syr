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
	async updatePost(post: PostUpdate) {
		const updatedPost = await postRepository.update(post.id, {
			...post,
			updated_at: new Date()
		});
		return updatedPost;
	}
	async deletePost(id: RecordId) {
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
