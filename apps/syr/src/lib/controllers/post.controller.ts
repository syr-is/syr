import { postRepository } from '$lib/repositories/post.repository';
import { folderRepository } from '$lib/repositories/folder.repository';
import { folderController } from './folder.controller';
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
	async deletePost(id: RecordId, ownerId: RecordId) {
		// Delete associated uploads folder (posts/{post_id}) if it exists
		// This also handles storage usage updates via folderController
		try {
			const postsFolder = await folderRepository.findByNameAndParent(ownerId, 'posts', null);
			if (postsFolder) {
				const postFolder = await folderRepository.findByNameAndParent(
					ownerId,
					id.toString(),
					postsFolder.id
				);
				if (postFolder) {
					// Delete the post folder and all its contents (including uploads)
					// This will update storage usage via folderController
					await folderController.deleteFolder(postFolder.id.toString(), ownerId, true);
				}
			}
		} catch (err) {
			// Log but don't fail post deletion if folder cleanup fails
			console.warn('Failed to clean up post assets folder:', err);
		}

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
