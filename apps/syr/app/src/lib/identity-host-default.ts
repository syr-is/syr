/**
 * Default public "home" URL for a did:syr identity on this Syr instance.
 */
export function defaultIdentityHostUrl(publicUrl: string, did: string): string {
	const base = publicUrl.replace(/\/$/, '');
	return `${base}/u/${encodeURIComponent(did)}`;
}

export function isValidIdentityHostUrl(s: string | null | undefined): s is string {
	if (!s || typeof s !== 'string' || s.trim() === '') return false;
	if (s.length > 2048) return false;
	try {
		const u = new URL(s.trim());
		return u.protocol === 'http:' || u.protocol === 'https:';
	} catch {
		return false;
	}
}
