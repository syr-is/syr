import type { Handle } from '@sveltejs/kit';
import { dbService } from '$lib/services/db';
import { verifyAccessToken } from '$lib/server/auth';
import { sessionRepository } from '$lib/repositories/session.repository';
import { profileRepository } from '$lib/repositories/profile.repository';

// Initialize database connection on server startup
let initPromise: Promise<void> | null = null;

async function initializeDatabase() {
	if (!initPromise) {
		initPromise = (async () => {
			try {
				await dbService.connect();
				await dbService.initializeSchema();
			} catch (error) {
				console.error('Failed to initialize database:', error);
				initPromise = null; // Reset on failure to allow retry
				throw error;
			}
		})();
	}
	return initPromise;
}

// Initialize on module load
initializeDatabase().catch(console.error);

/**
 * SvelteKit server hooks
 */
export const handle: Handle = async ({ event, resolve }) => {
	// Ensure database is initialized (will wait if already initializing)
	await initializeDatabase();

	// Check for session cookie
	const token = event.cookies.get('session');

	if (token) {
		try {
			// Verify JWT token
			const payload = verifyAccessToken(token);

			if (payload) {
				// Check if session exists and is not expired
				const session = await sessionRepository.findById(payload.sessionId);

				if (session && session.expires_at > new Date()) {
					// Fetch user profile
					const profile = await profileRepository.findByUserId(payload.userId);

					// Session is valid - attach user info to locals
					event.locals.user = {
						id: payload.userId,
						username: payload.username,
						role: payload.role,
						sessionId: payload.sessionId,
						profile: profile
							? {
									id: profile.id.toString(),
									display_name: profile.display_name,
									bio: profile.bio,
									avatar_url: profile.avatar_url,
									banner_url: profile.banner_url
								}
							: undefined
					};
				} else {
					// Session expired or not found - clean up
					if (session) {
						await sessionRepository.delete(payload.sessionId);
					}
					event.cookies.delete('session', { path: '/' });
				}
			} else {
				// Invalid token - delete cookie
				event.cookies.delete('session', { path: '/' });
			}
		} catch (error) {
			console.error('Session verification error:', error);
			event.cookies.delete('session', { path: '/' });
		}
	}

	// Add CORS headers
	const response = await resolve(event);

	// Add security headers
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-XSS-Protection', '1; mode=block');

	return response;
};
