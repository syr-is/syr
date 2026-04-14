/**
 * Validate that a URL is safe for use in media elements (img src, video src, background-image).
 * Only allows http(s) and relative paths. Rejects javascript:, data:, blob:, vbscript:, etc.
 */
export function isSafeMediaUrl(url: string | null | undefined): boolean {
	if (!url || typeof url !== 'string') return false;
	const trimmed = url.trim();
	if (!trimmed) return false;

	// Allow relative URLs (same-origin)
	if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;

	try {
		const parsed = new URL(trimmed);
		return parsed.protocol === 'https:' || parsed.protocol === 'http:';
	} catch {
		return false;
	}
}
