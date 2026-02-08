import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { postController } from '$lib/controllers/post.controller';
import { uploadController } from '$lib/controllers/upload.controller';
import { userRepository } from '$lib/repositories/user.repository';
import { stringToRecordId } from '@syr-is/types';

/** Extract upload record ID from the last segment of a media URL */
function extractUploadId(url: string): string | null {
	const path = url.split('?')[0].split('#')[0];
	const segments = path.split('/');
	return segments[segments.length - 1] || null;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	// Get post by ID
	const postId = stringToRecordId.decode(params.id);
	const post = await postController.getPost(postId);

	if (!post) {
		throw error(404, {
			code: 'NOT_FOUND',
			message: 'Post not found'
		});
	}

	// Check visibility
	// Public posts are viewable by anyone
	// Unlisted posts are viewable by anyone (but not listed in feeds)
	// Private posts are only viewable by the author
	let user = null;
	if (post.visibility === 'private') {
		if (!locals.user) {
			throw error(401, {
				code: 'AUTHENTICATION_ERROR',
				message: 'Unauthorized'
			});
		}

		user = await userRepository.findById(locals.user.id);
		if (!user) {
			throw error(400, {
				code: 'BAD_REQUEST',
				message: 'Invalid User'
			});
		}

		// Verify user owns the post
		if (post.author_id.toString() !== user.id.toString()) {
			throw error(403, {
				code: 'FORBIDDEN',
				message: 'You do not have permission to view this post'
			});
		}
	} else if (locals.user) {
		// Load user if logged in (for edit button check)
		user = await userRepository.findById(locals.user.id);
	}

	// Serialize post for client (convert RecordId to string, Date to ISO string)
	const serializedPost = {
		...post,
		id: post.id.toString(),
		author_id: post.author_id.toString(),
		created_at: post.created_at.toISOString(),
		updated_at: post.updated_at.toISOString()
	};

	// Serialize user if present
	const serializedUser = user
		? {
				...user,
				id: user.id.toString(),
				created_at: user.created_at.toISOString(),
				updated_at: user.updated_at.toISOString()
			}
		: null;

	// Resolve mime types for media post URLs from the upload DB records
	const mediaUrlMimeTypes: Record<string, string> = {};
	if (post.type === 'media' && post.media_urls?.length) {
		await Promise.all(
			post.media_urls.map(async (url) => {
				const uploadId = extractUploadId(url);
				if (uploadId) {
					try {
						const upload = await uploadController.getUpload(uploadId);
						if (upload) {
							mediaUrlMimeTypes[url] = upload.mime_type;
						}
					} catch {
						// Skip if upload record not found
					}
				}
			})
		);
	}

	return {
		post: serializedPost,
		user: serializedUser,
		mediaUrlMimeTypes
	};
};
