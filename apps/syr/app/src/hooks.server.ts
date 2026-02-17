import type { Handle } from '@sveltejs/kit';
import { dbService } from '$lib/services/db';
import { ensureS3Setup } from '$lib/services/s3-setup';
import { verifyAccessToken } from '$lib/server/auth';
import { sessionRepository } from '$lib/repositories/session.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { userRepository } from '$lib/repositories/user.repository';
import { registryOutboxService } from '$lib/services/registry-outbox.service';

// Initialize database connection on server startup
let initPromise: Promise<void> | null = null;
let s3SetupPromise: Promise<void> | null = null;

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

async function initializeS3() {
	if (!s3SetupPromise) {
		s3SetupPromise = ensureS3Setup().catch((error) => {
			s3SetupPromise = null; // allow retry on next request (ensureS3Setup resets its own cache on failure)
			throw error;
		});
	}
	return s3SetupPromise;
}

// Initialize on module load (run in parallel; they don't depend on each other)
Promise.all([initializeDatabase(), initializeS3()])
	.then(() => {
		// Start outbox processors after DB is ready
		registryOutboxService.start();
	})
	.catch(console.error);

/**
 * SvelteKit server hooks
 */
export const handle: Handle = async ({ event, resolve }) => {
	// Ensure database and S3 (bucket + CORS) are initialized (parallel for faster first request)
	await Promise.all([initializeDatabase(), initializeS3()]);

	// Check for session cookie
	const token = event.cookies.get('session');

	if (token) {
		try {
			// Verify JWT token
			const payload = verifyAccessToken(token);

			if (payload) {
				// Check if session exists and is not expired
				const session = await sessionRepository.findById(payload.sessionId);
				const user = await userRepository.findById(payload.userId);
				let profile = await profileRepository.findByUserId(payload.userId);

				if (!user) {
					if (session) {
						await sessionRepository.deleteByUserId(session.user_id);
					}
					if (profile) {
						await profileRepository.delete(profile.id);
					}
					event.cookies.delete('session', { path: '/' });
					return resolve(event);
				}

				if (session && session.expires_at > new Date()) {
					// Fetch user and profile data

					if (!profile) {
						profile = await profileRepository.createOrGetByUserId(payload.userId);
					}

					if (user) {
						// Session is valid - attach user info to locals
						event.locals.user = {
							id: user.id.toString(),
							username: user.username,
							did: user.did,
							role: user.role,
							created_at: user.created_at,
							updated_at: user.updated_at,
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

						// Update session last_active and backfill ip/ua if missing
						try {
							const ip =
								event.getClientAddress?.() ||
								event.request.headers.get('x-forwarded-for') ||
								undefined;
							const userAgent = event.request.headers.get('user-agent') || undefined;
							await sessionRepository.merge(payload.sessionId, {
								last_active: new Date(),
								ip: session.ip ?? ip,
								user_agent: session.user_agent ?? userAgent
							});
						} catch (_e) {
							// best-effort; ignore
						}
					}
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
