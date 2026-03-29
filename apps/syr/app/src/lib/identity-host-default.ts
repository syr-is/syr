/**
 * Default identity manifest URL for a did:syr identity on this Syr instance.
 * Points to the per-identity manifest at `/.well-known/syr/{did}` which supports
 * content negotiation: browsers get a redirect to the web profile, API clients
 * get a JSON manifest with endpoint locations.
 */
export function defaultIdentityHostUrl(publicUrl: string, did: string): string {
	const base = publicUrl.replace(/\/$/, '');
	return `${base}/.well-known/syr/${encodeURIComponent(did)}`;
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
