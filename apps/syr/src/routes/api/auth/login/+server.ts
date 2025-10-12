import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { UserLoginSchema } from '@syr-is/types';
import { authController } from '$lib/controllers/auth.controller';
import { config } from '$lib/config';

export const POST: RequestHandler = async ({ request, cookies }) => {
	try {
		const body = await request.json();

		// Validate request body
		const validatedData = UserLoginSchema.parse(body);

		// Login user
		const result = await authController.login(validatedData);

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
			{ status: 200 }
		);
	} catch (error) {
		console.error('Login error:', error);

		if (error instanceof Error) {
			// Handle invalid credentials
			if (error.message.includes('Invalid credentials')) {
				return json(
					{
						status: 'error',
						error: {
							code: 'INVALID_CREDENTIALS',
							message: 'Invalid username or password'
						}
					},
					{ status: 401 }
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
					message: 'Login failed'
				}
			},
			{ status: 500 }
		);
	}
};
