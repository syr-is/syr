import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { UserRegistrationInputSchema } from '@syr-is/types';
import { authController } from '$lib/controllers/auth.controller';
import { config } from '$lib/config';

export const POST: RequestHandler = async ({ request, cookies }) => {
	try {
		const body = await request.json();

		// Validate request body (without confirmPassword)
		const validatedData = UserRegistrationInputSchema.parse(body);

		// Register user
		const result = await authController.register(validatedData);

		// Set JWT as HTTP-only cookie
		cookies.set('session', result.token, {
			path: '/',
			httpOnly: true,
			secure: config.NODE_ENV === 'production',
			sameSite: 'strict',
			maxAge: 60 * 60 * 24 * 7 // 7 days
		});

		return json(
			{
				status: 'success',
				data: {
					user: result.user
				},
				meta: {
					timestamp: new Date().toISOString()
				}
			},
			{ status: 201 }
		);
	} catch (error) {
		console.error('Registration error:', error);

		if (error instanceof Error) {
			// Handle specific errors
			if (error.message.includes('already exists')) {
				return json(
					{
						status: 'error',
						error: {
							code: 'CONFLICT',
							message: error.message
						}
					},
					{ status: 409 }
				);
			}

			if (error.message.includes('Validation failed')) {
				return json(
					{
						status: 'error',
						error: {
							code: 'VALIDATION_ERROR',
							message: 'Invalid input data',
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
					code: 'INTERNAL_SERVER_ERROR',
					message: 'Registration failed'
				}
			},
			{ status: 500 }
		);
	}
};
