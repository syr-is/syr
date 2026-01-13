import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { userController } from '$lib/controllers/user.controller';
import { ProfileUpdateSchema } from '@syr-is/types';
import { z } from 'zod';

export const PATCH: RequestHandler = async ({ request, locals }) => {
	// Check authentication
	if (!locals.user) {
		throw error(401, {
			code: 'UNAUTHORIZED',
			message: 'You must be logged in to update your profile'
		});
	}

	try {
		// Parse and validate request body
		const body = await request.json();
		const data = ProfileUpdateSchema.parse(body);

		// Update profile
		const result = await userController.updateProfile(locals.user.id, data);

		return json({
			status: 'success',
			data: result
		});
	} catch (err) {
		console.error('Profile update error:', err);

		// Handle Zod validation errors
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid profile data',
				details: z.treeifyError(err)
			});
		}

		if (err instanceof Error) {
			if (err.message === 'Profile not found') {
				throw error(404, {
					code: 'NOT_FOUND',
					message: 'Profile not found'
				});
			}
		}

		throw error(500, {
			code: 'INTERNAL_ERROR',
			message: 'An unexpected error occurred'
		});
	}
};
