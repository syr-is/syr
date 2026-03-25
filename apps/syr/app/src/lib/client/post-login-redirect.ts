import { safePostLoginRedirectPath } from '$lib/post-login-redirect-path';

const COOKIE = 'post_login_redirect';

export function readAndClearPostLoginRedirectCookie(): string | null {
	if (typeof document === 'undefined') return null;
	const name = `${COOKIE}=`;
	const parts = document.cookie.split(';');
	let val = '';
	for (const p of parts) {
		const t = p.trim();
		if (t.startsWith(name)) {
			try {
				val = decodeURIComponent(t.slice(name.length));
			} catch {
				val = t.slice(name.length);
			}
			break;
		}
	}
	document.cookie = `${COOKIE}=; path=/; max-age=0`;
	return safePostLoginRedirectPath(val);
}
