/** Same-origin relative path only (no open redirects). */
export function safePostLoginRedirect(raw: string | null | undefined): string | null {
	if (raw == null || raw === '') return null;
	const s = raw.trim();
	if (!s.startsWith('/') || s.startsWith('//') || s.includes('://')) return null;
	if (s.length > 2048) return null;
	return s;
}

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
	return safePostLoginRedirect(val);
}
