/** Normalize registry base URL to Registry HTTP API root (…/api/v1). */
export function registryApiRoot(raw: string): string {
	const b = raw.trim().replace(/\/$/, '');
	if (b === '') {
		throw new Error('registryApiRoot: empty registry URL');
	}
	try {
		new URL(b);
	} catch {
		throw new Error(`registryApiRoot: invalid registry URL: ${raw}`);
	}
	if (b.endsWith('/api/v1')) return b;
	return `${b}/api/v1`;
}

/**
 * Canonical registry URL for storage and duplicate checks: trim, require http(s), collapse to …/api/v1.
 * @throws Error if empty, invalid URL, or not http(s)
 */
export function normalizeRegistryUrl(raw: string): string {
	const t = raw.trim();
	if (!t) {
		throw new Error('normalizeRegistryUrl: empty registry URL');
	}
	let u: URL;
	try {
		u = new URL(t);
	} catch {
		throw new Error(`normalizeRegistryUrl: invalid registry URL: ${raw}`);
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') {
		throw new Error('normalizeRegistryUrl: only http and https URLs are allowed');
	}
	return registryApiRoot(t);
}
