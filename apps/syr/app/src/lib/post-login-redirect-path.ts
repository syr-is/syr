/** Same-origin relative path only (no open redirects). */

const MAX_POST_LOGIN_PATH_LEN = 2048;
const MAX_URI_DECODE_STEPS = 8;

function isSafeRelativePath(s: string): boolean {
	if (s.length > MAX_POST_LOGIN_PATH_LEN) return false;
	if (!s.startsWith('/') || s.startsWith('//')) return false;
	// Only check for :// in the path portion, not in query params
	const pathOnly = s.split('?')[0];
	if (pathOnly.includes('://')) return false;
	return true;
}

/**
 * Repeatedly URI-decodes until stable (bounded steps), then validates a path-only redirect target.
 * Mitigates double-encoding tricks (e.g. `%2F%2F…`) that could bypass naive prefix checks.
 */
export function safePostLoginRedirectPath(raw: string | null | undefined): string | null {
	if (raw == null || raw === '') return null;
	let s = raw.trim();
	for (let i = 0; i < MAX_URI_DECODE_STEPS; i++) {
		let next: string;
		try {
			next = decodeURIComponent(s);
		} catch {
			return null;
		}
		if (next === s) break;
		s = next.trim();
	}
	if (!isSafeRelativePath(s)) return null;
	return s;
}
