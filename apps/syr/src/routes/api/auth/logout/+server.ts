import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyAccessToken } from '$lib/server/auth';
import { sessionRepository } from '$lib/repositories/session.repository';

export const POST: RequestHandler = async ({ cookies }) => {
	try {
		// Get the session cookie
		const token = cookies.get('session');

		if (token) {
			try {
				// Verify token and get session ID
				const payload = verifyAccessToken(token);

				// Delete session from database
				if (payload) {
					await sessionRepository.delete(payload.sessionId);
				}
			} catch (error) {
				// Token invalid or session already deleted - that's fine, continue with logout
				console.log('Session cleanup skipped:', error);
			}
		}

		// Clear the auth cookie
		cookies.delete('session', {
			path: '/'
		});

		return json(
			{
				status: 'success',
				data: {
					message: 'Logged out successfully'
				},
				meta: {
					timestamp: new Date().toISOString()
				}
			},
			{ status: 200 }
		);
	} catch (error) {
		console.error('Logout error:', error);

		// Still clear the cookie even if DB deletion fails
		cookies.delete('session', {
			path: '/'
		});

		return json(
			{
				status: 'error',
				error: {
					code: 'LOGOUT_ERROR',
					message: 'Logout completed with errors'
				}
			},
			{ status: 500 }
		);
	}
};
