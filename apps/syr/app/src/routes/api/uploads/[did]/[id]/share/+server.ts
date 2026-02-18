import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { uploadController } from '$lib/controllers/upload.controller';
import { recordIdFromDidAndLocal } from '@syr-is/types';

const ShareUrlSchema = z.object({
	// Expiry in seconds - default 1 hour, max 7 days
	expiresIn: z
		.number()
		.int()
		.min(60) // Minimum 1 minute
		.max(604800) // Maximum 7 days
		.default(3600)
});

export const POST: RequestHandler = async ({ params, request, locals }) => {
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

	try {
		const uploadId = recordIdFromDidAndLocal('upload', params.did, params.id);
		const upload = await uploadController.getUpload(uploadId);

		if (!upload) {
			throw error(404, {
				code: 'NOT_FOUND',
				message: 'Upload not found'
			});
		}

		// Check ownership
		if (upload.owner_id.toString() !== user.id.toString()) {
			throw error(403, {
				code: 'FORBIDDEN',
				message: 'You do not have permission to share this upload'
			});
		}

		// Parse request body
		let expiresIn = 3600; // Default 1 hour
		try {
			const body = await request.json();
			const data = ShareUrlSchema.parse(body);
			expiresIn = data.expiresIn;
		} catch {
			// Use default if body is empty or invalid
		}

		// Generate share URL
		const result = await uploadController.getShareUrl(uploadId, expiresIn);

		if (!result) {
			throw error(400, {
				code: 'BAD_REQUEST',
				message: 'Unable to generate share URL for this upload'
			});
		}

		return json({
			status: 'success',
			data: {
				url: result.url,
				expiresAt: result.expiresAt.toISOString(),
				isPublic: result.isPublic
			},
			meta: {
				timestamp: new Date().toISOString()
			}
		});
	} catch (err) {
		console.error('Generate share URL error:', err);

		// Re-throw SvelteKit errors
		if (err && typeof err === 'object' && 'status' in err && 'body' in err) {
			throw err;
		}

		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Failed to generate share URL'
		});
	}
};
