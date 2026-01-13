import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { UserLoginSchema } from '@syr-is/types';
import { authController } from '$lib/controllers/auth.controller';
import { config } from '$lib/config';
import { z } from 'zod';

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	try {
		const body = await request.json();

		// Validate request body
		const validatedData = UserLoginSchema.parse(body);

		// Session context
		const ip = getClientAddress?.() || request.headers.get('x-forwarded-for') || undefined;
		const userAgent = request.headers.get('user-agent') || undefined;

		// Login user
		const result = await authController.login(validatedData, { ip, userAgent });

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
	} catch (err) {
		console.error('Login error:', err);

		// Handle Zod validation errors
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid input data',
				details: z.treeifyError(err)
			});
		}

		if (err instanceof Error) {
			// Handle invalid credentials
			if (err.message.includes('Invalid credentials')) {
				throw error(401, {
					code: 'INVALID_CREDENTIALS',
					message: 'Invalid username or password'
				});
			}

			if (err.message.includes('Validation failed')) {
				throw error(400, {
					code: 'VALIDATION_ERROR',
					message: err.message
				});
			}
		}

		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Login failed'
		});
	}
};
