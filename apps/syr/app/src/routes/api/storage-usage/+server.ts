import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { userRepository } from '$lib/repositories/user.repository';
import { fileStoreUsageController } from '$lib/controllers/file-store-usage.controller';

/**
 * GET /api/storage-usage
 * Get user's file storage usage
 */
export const GET: RequestHandler = async ({ locals }) => {
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

	const usageDetails = await fileStoreUsageController.getUsageDetails(user.id);

	return json({
		status: 'success',
		data: usageDetails,
		meta: { timestamp: new Date().toISOString() }
	});
};
