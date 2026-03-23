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
