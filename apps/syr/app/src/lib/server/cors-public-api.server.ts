/**
 * True when the request is a public read to `/api/public/*` (GET or OPTIONS preflight).
 */
export function isPublicApiReadRequest(pathname: string, method: string): boolean {
	const m = method.toUpperCase();
	if (m !== 'GET' && m !== 'OPTIONS') return false;
	return pathname.startsWith('/api/public/');
}
