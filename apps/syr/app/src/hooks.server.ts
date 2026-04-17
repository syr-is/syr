import type { Handle } from '@sveltejs/kit';
import { dbService } from '$lib/services/db';
import { ensureS3Setup } from '$lib/services/s3-setup';
import { kvService } from '$lib/services/kv';
import { verifyAccessToken } from '$lib/server/auth';
import { sessionRepository } from '$lib/repositories/session.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { userRepository } from '$lib/repositories/user.repository';
import {
	allowedOrigins,
	config,
	cors,
	isAllowedOrigin,
	isValidCorsReflectOrigin
} from '$lib/config';
import { isPublicApiReadRequest } from '$lib/server/cors-public-api.server';

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

/** Interval for cleaning expired KV entries (challenges, callback tokens, etc.). Runs every 2 min. */
const KV_CLEANUP_INTERVAL_MS = 120_000;

// Initialize on module load (run in parallel; they don't depend on each other)
Promise.all([initializeDatabase(), initializeS3()])
	.then(async () => {
		// Clean up expired KV entries (independent login challenges, identity auth, callback tokens)
		const runCleanup = async () => {
			try {
				const removed = await kvService.cleanup();
				if (removed > 0) {
					console.debug(`[kv] Cleaned ${removed} expired entries`);
				}
			} catch (e) {
				console.error('[kv] Cleanup failed:', e);
			}
		};
		await runCleanup(); // Initial cleanup on startup
		setInterval(runCleanup, KV_CLEANUP_INTERVAL_MS);
	})
	.catch(console.error);

/**
 * SvelteKit server hooks
 */
export const handle: Handle = async ({ event, resolve }) => {
	// Ensure database and S3 (bucket + CORS) are initialized (parallel for faster first request)
	await Promise.all([initializeDatabase(), initializeS3()]);

	// Check for session cookie or Authorization: Bearer header (platform delegation)
	const authHeader = event.request.headers.get('authorization');
	const token =
		event.cookies.get('session') ??
		(authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined);

	if (token) {
		try {
			// Verify JWT token
			const payload = verifyAccessToken(token);

			if (payload) {
				const isPlatformToken = payload.sessionId.startsWith('platform:');
				const user = await userRepository.findById(payload.userId);

				if (!user) {
					if (!isPlatformToken) {
						const session = await sessionRepository.findById(payload.sessionId);
						if (session) {
							await sessionRepository.deleteByUserId(session.user_id);
						}
						const profile = await profileRepository.findByUserId(payload.userId);
						if (profile) {
							await profileRepository.delete(profile.id);
						}
						event.cookies.delete('session', { path: '/' });
					}
					return resolve(event);
				}

				// Platform delegation tokens skip session table lookup
				const session = isPlatformToken
					? null
					: await sessionRepository.findById(payload.sessionId);
				if (isPlatformToken || (session && session.expires_at > new Date())) {
					let profile = await profileRepository.findByUserId(payload.userId);

					if (!profile) {
						profile = await profileRepository.createOrGetByUserId(payload.userId);
					}

					// Session is valid - attach user info to locals
					event.locals.user = {
						id: user.id.toString(),
						username: user.username,
						did: user.did,
						role: user.role,
						created_at: user.created_at,
						updated_at: user.updated_at,
						sessionId: payload.sessionId,
						signing_warn_before_each_action: user.signing_warn_before_each_action ?? true,
						signing_require_explicit_sign_button: user.signing_require_explicit_sign_button ?? true,
						profile: profile
							? {
									id: profile.id.toString(),
									display_name: profile.display_name,
									bio: profile.bio,
									avatar_url: profile.avatar_url,
									banner_url: profile.banner_url,
									identity_host_url: profile.identity_host_url,
									content_signature: profile.content_signature,
									signed_payload_json: profile.signed_payload_json,
									signing_device_public_key: profile.signing_device_public_key
								}
							: undefined
					};

					// Update session last_active and backfill ip/ua if missing
					if (session) {
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

	// Handle CORS preflight (OPTIONS)
	const origin = event.request.headers.get('origin');
	const pathname = event.url.pathname;
	const method = event.request.method;
	const publicReadOpen =
		!!origin &&
		isValidCorsReflectOrigin(origin) &&
		config.CORS_REFLECT_ANY_ORIGIN_PUBLIC_API &&
		isPublicApiReadRequest(pathname, method);
	const strictAllow = !!origin && isAllowedOrigin(origin, allowedOrigins);
	const originAllowed = publicReadOpen || strictAllow;
	const reflectCredentials = originAllowed && !publicReadOpen && cors.credentials;

	if (event.request.method === 'OPTIONS') {
		// Deny preflight when origin present but not allowed
		if (origin && !originAllowed) {
			return new Response(null, {
				status: 403,
				headers: {
					Vary: 'Origin',
					'Cache-Control': 'no-store'
				}
			});
		}
		return new Response(null, {
			status: 204,
			headers: {
				Vary: 'Origin',
				'Access-Control-Allow-Origin': originAllowed && origin ? origin : '*',
				'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization',
				'Access-Control-Max-Age': '86400',
				...(reflectCredentials ? { 'Access-Control-Allow-Credentials': 'true' } : {})
			}
		});
	}

	const response = await resolve(event);

	const existingVary = response.headers.get('Vary') ?? '';
	const varySet = new Set(
		existingVary
			.split(',')
			.map((v) => v.trim())
			.filter(Boolean)
	);
	varySet.add('Origin');
	response.headers.set('Vary', [...varySet].join(', '));
	// Add CORS headers for cross-origin requests
	if (origin && originAllowed) {
		response.headers.set('Access-Control-Allow-Origin', origin);
		if (reflectCredentials) {
			response.headers.set('Access-Control-Allow-Credentials', 'true');
		}
	}

	// Security headers
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-XSS-Protection', '1; mode=block');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set(
		'Content-Security-Policy',
		[
			"default-src 'self'",
			"img-src 'self' https: http: data:",
			"media-src 'self' https: http:",
			"script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
			"worker-src 'self' blob:",
			"style-src 'self' 'unsafe-inline'",
			"connect-src 'self' https: http: ws: wss:",
			"font-src 'self'",
			"frame-ancestors 'none'",
			"base-uri 'self'",
			"form-action 'self' https: http:"
		].join('; ')
	);

	return response;
};
