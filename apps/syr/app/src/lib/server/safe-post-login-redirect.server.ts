/** Same-origin relative path only (no open redirects). */
export function safePostLoginRedirectPath(raw: string | null | undefined): string | null {
	if (raw == null || raw === '') return null;
	const s = raw.trim();
	if (!s.startsWith('/') || s.startsWith('//') || s.includes('://')) return null;
	if (s.length > 2048) return null;
	return s;
}
