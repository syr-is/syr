/** Schemes allowed for instance/callback. https always; http only for localhost/127.0.0.1 */
function isValidUrlScheme(u: URL): boolean {
	if (u.protocol === 'https:') return true;
	if (u.protocol === 'http:') {
		const h = u.hostname.toLowerCase();
		return h === 'localhost' || h === '127.0.0.1';
	}
	return false;
}

/**
 * Parses a syr://login URL and extracts challenge, instance, and callback params.
 * Used for both deep-link handling and QR scan flow.
 * Validates instance and callback: must be valid URLs with safe scheme
 * (https everywhere; http only on localhost/127.0.0.1). Callback origin must match instance.
 */
export function parseSyrLoginUrl(
	urlStr: string
): { challenge: string; instance: string; callback: string } | null {
	try {
		const url = new URL(urlStr);
		if (url.protocol !== 'syr:' || url.hostname !== 'login') return null;
		const challenge = url.searchParams.get('challenge');
		const instanceRaw = url.searchParams.get('instance');
		const callbackRaw = url.searchParams.get('callback');
		if (!challenge || !instanceRaw || !callbackRaw) return null;

		const instance = decodeURIComponent(instanceRaw);
		const callback = decodeURIComponent(callbackRaw);

		const instanceUrl = new URL(instance);
		const callbackUrl = new URL(callback);
		if (!isValidUrlScheme(instanceUrl) || !isValidUrlScheme(callbackUrl)) return null;
		if (callbackUrl.origin !== instanceUrl.origin) return null;

		return { challenge, instance, callback };
	} catch {
		// ignore
	}
	return null;
}
