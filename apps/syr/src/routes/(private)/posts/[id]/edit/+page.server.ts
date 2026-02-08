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
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'Unauthorized'
		});
	}

	const user = await userRepository.findById(locals.user.id);
	if (!user) {
		throw error(400, {
			code: 'BAD_REQUEST',
			message: 'Invalid User'
		});
	}

	// Get post by ID
	const post = await postController.getPost(stringToRecordId.decode(params.id));
	if (!post) {
		throw error(404, {
			code: 'NOT_FOUND',
			message: 'Post not found'
		});
	}

	// Verify user owns the post
	if (post.author_id.toString() !== user.id.toString()) {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'You do not have permission to edit this post'
		});
	}

	// Serialize post for client (convert RecordId to string, Date to ISO string)
	const serializedPost = {
		...post,
		id: post.id.toString(),
		author_id: post.author_id.toString(),
		created_at: post.created_at.toISOString(),
		updated_at: post.updated_at.toISOString()
	};

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
		mediaUrlMimeTypes
	};
};
