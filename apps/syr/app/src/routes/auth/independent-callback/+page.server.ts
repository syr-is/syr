import { redirect, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { config } from '$lib/config';
import { consumeCallbackToken } from '$lib/server/independent-login-store';
import { verifyAccessToken } from '$lib/server/auth';
import { profileRepository } from '$lib/repositories/profile.repository';
import { safePostLoginRedirectPath } from '$lib/server/safe-post-login-redirect.server';

/** Profile needs onboarding when display_name is auto-generated (il_xxx pattern). */
function needsOnboarding(displayName: string | null | undefined): boolean {
	return !!displayName && /^il_[a-zA-Z0-9_-]+_\w{6}$/.test(displayName);
}

/**
 * Callback page for independent login.
 * Exchanges one-time token for session cookie and redirects to home or onboarding.
 */
export const load: PageServerLoad = async ({ url, cookies }) => {
	const token = url.searchParams.get('token');
	if (!token) {
		throw redirect(302, '/login?error=missing_token');
	}

	const jwt = await consumeCallbackToken(token);
	if (!jwt) {
		throw redirect(302, '/login?error=expired');
	}

	const payload = verifyAccessToken(jwt);
	if (!payload) {
		throw redirect(302, '/login?error=invalid_token');
	}

	cookies.set('session', jwt, {
		path: '/',
		httpOnly: true,
		secure: config.NODE_ENV === 'production',
		sameSite: 'strict',
		maxAge: 60 * 60 * 24 * 7 // 7 days
	});

	try {
		const profile = await profileRepository.findByUserId(payload.userId);
		if (profile && needsOnboarding(profile.display_name)) {
			throw redirect(302, '/settings/sync-syner');
		}
	} catch (err) {
		if (isRedirect(err)) throw err;
		console.error('Onboarding check failed:', err);
		// fail-open: continue to redirect to /
	}

	const postLogin = cookies.get('post_login_redirect');
	if (postLogin) {
		cookies.delete('post_login_redirect', { path: '/' });
		const safe = safePostLoginRedirectPath(postLogin);
		if (safe) {
			throw redirect(302, safe);
		}
	}

	throw redirect(302, '/');
};
