import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { UserRegistrationInputSchema } from '@syr-is/types';
import {
	authController,
	RegistrationClosedError,
	InviteRequiredError,
	InvalidInviteCodeError
} from '$lib/controllers/auth.controller';
import { config } from '$lib/config';
import { z } from 'zod';

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	try {
		const body = await request.json();

		// Validate request body (without confirmPassword)
		const validatedData = UserRegistrationInputSchema.parse(body);

		// Session context
		const ip = getClientAddress?.() || request.headers.get('x-forwarded-for') || undefined;
		const userAgent = request.headers.get('user-agent') || undefined;

		// Register user
		const result = await authController.register(validatedData, { ip, userAgent });

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
	} catch (err) {
		console.error('Registration error:', err);

		// Handle Zod validation errors
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid input data',
				details: z.treeifyError(err)
			});
		}

		if (err instanceof RegistrationClosedError) {
			throw error(403, {
				code: 'FORBIDDEN',
				message: 'Registration is currently closed on this instance'
			});
		}

		if (err instanceof InviteRequiredError) {
			throw error(400, {
				code: 'INVITE_REQUIRED',
				message: 'An invite code is required to register on this instance'
			});
		}

		if (err instanceof InvalidInviteCodeError) {
			throw error(400, {
				code: 'INVALID_INVITE_CODE',
				message: err.message
			});
		}

		if (err instanceof Error) {
			if (err.message.includes('already exists')) {
				throw error(409, {
					code: 'CONFLICT',
					message: err.message
				});
			}

			if (err.message.includes('Validation failed')) {
				throw error(400, {
					code: 'VALIDATION_ERROR',
					message: 'Invalid input data',
					details: err.message
				});
			}
		}

		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Registration failed'
		});
	}
};
