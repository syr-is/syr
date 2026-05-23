import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { uploadController } from '$lib/controllers/upload.controller';
import { profileRepository } from '$lib/repositories/profile.repository';
import { recordIdFromDidAndLocal } from '@syr-is/types';
import { s3 } from '$lib/config';

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];

const BodySchema = z.object({
	role: z.enum(['avatar', 'banner']),
	upload_did: z.string().min(1),
	upload_local_id: z.string().min(1)
});

/**
 * PATCH /api/user/profile-asset
 *
 * Set profile avatar or banner from an existing upload.
 * Requires the upload to be owned by the user and public (is_public).
 */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'UNAUTHORIZED',
			message: 'Authentication required'
		});
	}

	let body: z.infer<typeof BodySchema>;
	try {
		body = BodySchema.parse(await request.json());
	} catch {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message:
				'Invalid request body: role (avatar|banner), upload_did, and upload_local_id required'
		});
	}

	const user = await userRepository.findById(locals.user.id);
	if (!user) {
		throw error(404, { code: 'NOT_FOUND', message: 'User not found' });
	}

	const uploadRecordId = recordIdFromDidAndLocal('upload', body.upload_did, body.upload_local_id);
	const upload = await uploadController.getUpload(uploadRecordId);
	if (!upload) {
		throw error(404, { code: 'NOT_FOUND', message: 'Upload not found' });
	}

	if (upload.owner_id.toString() !== user.id.toString()) {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'You can only use your own uploads as profile assets'
		});
	}

	if (!upload.is_public) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Profile assets must be from a public upload'
		});
	}

	if (!upload.url) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Upload has no URL'
		});
	}

	if (!IMAGE_MIMES.includes(upload.mime_type)) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Profile assets must be images (png, jpeg, gif, webp)'
		});
	}

	// Derive URL from key + current S3_PUBLIC_URL config rather than the stored
	// upload.url, which may have been written with a stale/wrong endpoint.
	const currentUrl = upload.key ? `${s3.publicUrl}/${s3.bucket}/${upload.key}` : upload.url;
	const updates = body.role === 'avatar' ? { avatar_url: currentUrl } : { banner_url: currentUrl };

	const profile = await profileRepository.mergeByUserId(user.id, updates);
	return json({
		status: 'success',
		data: { profile }
	});
};
