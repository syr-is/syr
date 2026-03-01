/**
 * Parses a syr://login URL and extracts challenge, instance, and callback params.
 * Used for both deep-link handling and QR scan flow.
 */
export function parseSyrLoginUrl(
	urlStr: string
): { challenge: string; instance: string; callback: string } | null {
	try {
		const url = new URL(urlStr);
		if (url.protocol !== 'syr:' || url.hostname !== 'login') return null;
		const challenge = url.searchParams.get('challenge');
		const instance = url.searchParams.get('instance');
		const callback = url.searchParams.get('callback');
		if (challenge && instance && callback) {
			return { challenge, instance, callback };
		}
	} catch {
		// ignore
	}
	return null;
}
