/**
 * Normalize a Syr provider base URL (http/https, no trailing slash).
 * Rejects userinfo and non-http(s) schemes. Use for follow rows and API validation.
 */
export function normalizeProviderBaseUrl(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	try {
		const u = new URL(trimmed);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
		if (u.username || u.password) return null;
		const path = u.pathname.replace(/\/+$/, '');
		const base = path ? `${u.origin}${path}` : u.origin;
		return base.replace(/\/+$/, '');
	} catch {
		return null;
	}
}
