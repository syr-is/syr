import { kvService } from '$lib/services/kv';
import { postRepository } from '$lib/repositories/post.repository';
import type { Post, User } from '@syr-is/types';
import { extractDid, extractLocalId, recordIdFromDidAndLocal } from '@syr-is/types';
import type { RecordId } from 'surrealdb';

/**
 * Maximum number of pinned posts allowed per user
 */
const MAX_PINNED_POSTS = 10;

/**
 * KV type for pinned posts
 */
const KV_TYPE = 'pinned_posts';

/**
 * Pinned Posts Data Structure
 * Stored in KV as kv:pinned_posts:user_id
 */
interface PinnedPostsData {
	/** Ordered array of post IDs (first = highest priority) */
	post_ids: string[];
}

/**
 * Pinned Posts Controller
 * Manages ordered pinned posts for users using KV storage
 */
export class PinnedPostsController {
	/**
	 * Get the KV index for a user's pinned posts
	 */
	private getUserIndex(userId: RecordId | string): string {
		return typeof userId === 'string' ? userId : userId.toString();
	}

	/**
	 * Get user's pinned post IDs in order
	 */
	async getPinnedPostIds(userId: RecordId | string): Promise<string[]> {
		const index = this.getUserIndex(userId);
		const data = await kvService.get<PinnedPostsData>(KV_TYPE, index);
		return data?.post_ids ?? [];
	}

	/**
	 * Get user's pinned posts with full post data, maintaining order
	 */
	async getPinnedPosts(userId: RecordId | string): Promise<Post[]> {
		const postIds = await this.getPinnedPostIds(userId);
		if (postIds.length === 0) return [];

		// Fetch all posts in parallel
		const posts = await Promise.all(
			postIds.map(async (idStr) => {
				try {
					const slashIdx = idStr.lastIndexOf('/');
					if (slashIdx === -1) return null;
					const did = idStr.substring(0, slashIdx);
					const localId = idStr.substring(slashIdx + 1);
					const recordId = recordIdFromDidAndLocal('post', did, localId);
					return await postRepository.findById(recordId);
				} catch {
					return null;
				}
			})
		);

		// Filter out null values (deleted posts) and maintain order
		const validPosts = posts.filter((p): p is Post => p !== null);

		// Clean up any orphaned post IDs
		if (validPosts.length !== postIds.length) {
			const validIds = validPosts.map((p) => `${extractDid(p.id)}/${extractLocalId(p.id)}`);
			await this.savePinnedPostIds(userId, validIds);
		}

		return validPosts;
	}

	/**
	 * Save pinned post IDs
	 */
	private async savePinnedPostIds(userId: RecordId | string, postIds: string[]): Promise<void> {
		const index = this.getUserIndex(userId);
		const data: PinnedPostsData = { post_ids: postIds };
		await kvService.set(KV_TYPE, index, data);
	}

	/**
	 * Check if a post is pinned
	 */
	async isPinned(userId: RecordId | string, postId: RecordId | string): Promise<boolean> {
		const postIds = await this.getPinnedPostIds(userId);
		const postIdStr = typeof postId === 'string' ? postId : postId.toString();
		return postIds.includes(postIdStr);
	}

	/**
	 * Parse post_id string to RecordId.
	 * Accepts: "did:syr:.../localId" (canonical) or RecordId.toString() (SurrealDB object format).
	 */
	private parsePostId(postId: RecordId | string): RecordId {
		if (typeof postId !== 'string') return postId;
		// Canonical format: did/localId
		const slashIdx = postId.lastIndexOf('/');
		if (slashIdx !== -1) {
			const did = postId.substring(0, slashIdx);
			const localId = postId.substring(slashIdx + 1);
			return recordIdFromDidAndLocal('post', did, localId);
		}
		// SurrealDB RecordId.toString() format: post:{ "created_by": s"did:...", "id": s"ulid" }
		const createdByMatch = postId.match(/"created_by":\s*s"([^"]+)"/);
		const idMatch = postId.match(/"id":\s*s"([^"]+)"/);
		if (createdByMatch && idMatch) {
			return recordIdFromDidAndLocal('post', createdByMatch[1], idMatch[1]);
		}
		throw new Error(`Invalid post_id format: ${postId.slice(0, 80)}...`);
	}

	/**
	 * Normalize post_id to canonical "did/localId" format for storage.
	 */
	private toCanonicalPostId(recordId: RecordId): string {
		return `${extractDid(recordId)}/${extractLocalId(recordId)}`;
	}

	/**
	 * Pin a post (appends to end of pinned list)
	 * @returns The updated list of pinned post IDs
	 * @throws Error if max pinned posts reached or post already pinned
	 */
	async pinPost(
		user: User,
		postId: RecordId | string
	): Promise<{ success: boolean; post_ids: string[]; message?: string }> {
		const recordId = this.parsePostId(postId);
		const postIdStr = this.toCanonicalPostId(recordId);

		// Verify post exists and belongs to user
		const post = await postRepository.findById(recordId);
		if (!post) {
			return { success: false, post_ids: [], message: 'Post not found' };
		}
		if (post.author_id.toString() !== user.id.toString()) {
			return { success: false, post_ids: [], message: 'You can only pin your own posts' };
		}

		const currentPinned = await this.getPinnedPostIds(user.id);

		// Check if already pinned
		if (currentPinned.includes(postIdStr)) {
			return { success: false, post_ids: currentPinned, message: 'Post is already pinned' };
		}

		// Check max limit
		if (currentPinned.length >= MAX_PINNED_POSTS) {
			return {
				success: false,
				post_ids: currentPinned,
				message: `Maximum ${MAX_PINNED_POSTS} pinned posts allowed`
			};
		}

		// Append to end
		const newPinned = [...currentPinned, postIdStr];
		await this.savePinnedPostIds(user.id, newPinned);

		return { success: true, post_ids: newPinned };
	}

	/**
	 * Unpin a post
	 * @returns The updated list of pinned post IDs
	 */
	async unpinPost(
		user: User,
		postId: RecordId | string
	): Promise<{ success: boolean; post_ids: string[]; message?: string }> {
		const recordId = this.parsePostId(postId);
		const postIdStr = this.toCanonicalPostId(recordId);
		const currentPinned = await this.getPinnedPostIds(user.id);

		// Check if pinned
		if (!currentPinned.includes(postIdStr)) {
			return { success: false, post_ids: currentPinned, message: 'Post is not pinned' };
		}

		// Remove from list
		const newPinned = currentPinned.filter((id) => id !== postIdStr);
		await this.savePinnedPostIds(user.id, newPinned);

		return { success: true, post_ids: newPinned };
	}

	/**
	 * Reorder pinned posts
	 * @param newOrder - Array of post IDs in the desired order
	 * @returns The updated list of pinned post IDs
	 */
	async reorderPinnedPosts(
		user: User,
		newOrder: string[]
	): Promise<{ success: boolean; post_ids: string[]; message?: string }> {
		const currentPinned = await this.getPinnedPostIds(user.id);

		// Validate that all IDs in newOrder are currently pinned
		const currentSet = new Set(currentPinned);
		const newSet = new Set(newOrder);

		// Check for any invalid IDs
		for (const id of newOrder) {
			if (!currentSet.has(id)) {
				return {
					success: false,
					post_ids: currentPinned,
					message: `Post ${id} is not currently pinned`
				};
			}
		}

		// Check that all currently pinned posts are in the new order
		for (const id of currentPinned) {
			if (!newSet.has(id)) {
				return {
					success: false,
					post_ids: currentPinned,
					message: `Missing pinned post ${id} in new order`
				};
			}
		}

		// Validate no duplicates
		if (newOrder.length !== newSet.size) {
			return { success: false, post_ids: currentPinned, message: 'Duplicate post IDs in order' };
		}

		await this.savePinnedPostIds(user.id, newOrder);
		return { success: true, post_ids: newOrder };
	}

	/**
	 * Move a pinned post to a specific position
	 * @param postId - The post to move
	 * @param newIndex - The new position (0-based)
	 */
	async movePinnedPost(
		user: User,
		postId: RecordId | string,
		newIndex: number
	): Promise<{ success: boolean; post_ids: string[]; message?: string }> {
		const postIdStr = typeof postId === 'string' ? postId : postId.toString();
		const currentPinned = await this.getPinnedPostIds(user.id);

		const currentIndex = currentPinned.indexOf(postIdStr);
		if (currentIndex === -1) {
			return { success: false, post_ids: currentPinned, message: 'Post is not pinned' };
		}

		// Clamp newIndex to valid range
		const clampedIndex = Math.max(0, Math.min(newIndex, currentPinned.length - 1));

		// Remove from current position and insert at new position
		const newPinned = [...currentPinned];
		newPinned.splice(currentIndex, 1);
		newPinned.splice(clampedIndex, 0, postIdStr);

		await this.savePinnedPostIds(user.id, newPinned);
		return { success: true, post_ids: newPinned };
	}

	/**
	 * Clear all pinned posts for a user
	 */
	async clearPinnedPosts(user: User): Promise<void> {
		const index = this.getUserIndex(user.id);
		await kvService.delete(KV_TYPE, index);
	}
}

// Export singleton instance
export const pinnedPostsController = new PinnedPostsController();
