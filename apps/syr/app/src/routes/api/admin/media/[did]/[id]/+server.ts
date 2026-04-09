import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordIdFromDidAndLocal } from '@syr-is/types';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Service } from '$lib/services/s3';
import { s3 } from '$lib/config';

/**
 * GET /api/admin/media/[did]/[id]
 * Get upload details with a download URL (signed for private, direct for public).
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	if (locals.user.role !== 'ADMIN') throw error(403, { code: 'FORBIDDEN', message: 'Admin only' });

	const uploadId = recordIdFromDidAndLocal('upload', params.did, params.id);
	const upload = await uploadRepository.findById(uploadId);
	if (!upload) throw error(404, { code: 'NOT_FOUND', message: 'Upload not found' });

	if (!upload.key?.startsWith('instance-media/')) {
		throw error(403, { code: 'FORBIDDEN', message: 'Not an instance media upload' });
	}

	let downloadUrl: string | null = null;
	const isPublic = upload.is_public;

	if (upload.status === 'completed' && upload.key) {
		if (isPublic) {
			downloadUrl = upload.url || `${s3.endpoint}/${s3.bucket}/${upload.key}`;
		} else {
			const command = new GetObjectCommand({ Bucket: s3.bucket, Key: upload.key });
			downloadUrl = await getSignedUrl(s3Service.client, command, { expiresIn: 3600 });
		}
	}

	return json({
		status: 'success',
		data: { ...upload, downloadUrl, isPublic }
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	if (locals.user.role !== 'ADMIN') throw error(403, { code: 'FORBIDDEN', message: 'Admin only' });

	const uploadId = recordIdFromDidAndLocal('upload', params.did, params.id);
	const upload = await uploadRepository.findById(uploadId);
	if (!upload) throw error(404, { code: 'NOT_FOUND', message: 'Upload not found' });

	if (!upload.key?.startsWith('instance-media/')) {
		throw error(403, { code: 'FORBIDDEN', message: 'Not an instance media upload' });
	}

	if (upload.key) {
		await s3Service.client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: upload.key }));
	}
	await uploadRepository.delete(uploadId);

	return json({ status: 'success', message: 'Instance media deleted' });
};
