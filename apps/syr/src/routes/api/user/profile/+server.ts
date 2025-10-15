import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { userController } from '$lib/controllers/user.controller';
import { ProfileUpdateSchema } from '@syr-is/types';

export const PATCH: RequestHandler = async ({ request, locals }) => {
	// Check authentication
	if (!locals.user) {
		return json(
			{
				status: 'error',
				error: {
					code: 'UNAUTHORIZED',
					message: 'You must be logged in to update your profile'
				}
			},
			{ status: 401 }
		);
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
	} catch (error) {
		console.error('Profile update error:', error);

		if (error instanceof Error) {
			if (error.message === 'Profile not found') {
				return json(
					{
						status: 'error',
						error: {
							code: 'NOT_FOUND',
							message: 'Profile not found'
						}
					},
					{ status: 404 }
				);
			}

			// Validation error
			if (error.name === 'ZodError') {
				return json(
					{
						status: 'error',
						error: {
							code: 'VALIDATION_ERROR',
							message: 'Invalid profile data',
							details: error.message
						}
					},
					{ status: 400 }
				);
			}
		}

		return json(
			{
				status: 'error',
				error: {
					code: 'INTERNAL_ERROR',
					message: 'An unexpected error occurred'
				}
			},
			{ status: 500 }
		);
	}
};
