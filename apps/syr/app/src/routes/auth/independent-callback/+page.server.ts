import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { config } from '$lib/config';
import { consumeCallbackToken } from '$lib/server/independent-login-store';

/**
 * Callback page for independent login.
 * Exchanges one-time token for session cookie and redirects to home.
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

	cookies.set('session', jwt, {
		path: '/',
		httpOnly: true,
		secure: config.NODE_ENV === 'production',
		sameSite: 'strict',
		maxAge: 60 * 60 * 24 * 7 // 7 days
	});

	throw redirect(302, '/');
};
