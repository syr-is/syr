/** Private/local hostnames for http scheme. https always allowed. */
function isPrivateOrLocalHost(hostname: string): boolean {
	const h = hostname.toLowerCase();
	if (h === 'localhost') return true;
	// 127.0.0.0/8
	if (h.startsWith('127.')) return true;
	// 192.168.0.0/16
	if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
	// 10.0.0.0/8
	if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
	// 172.16.0.0/12
	if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
	return false;
}

/** Schemes allowed for instance/callback. https always; http only for localhost and private networks. */
function isValidUrlScheme(u: URL): boolean {
	if (u.protocol === 'https:') return true;
	if (u.protocol === 'http:') return isPrivateOrLocalHost(u.hostname);
	return false;
}

/**
 * Validates an instance URL string. Returns normalized origin (scheme + host + port) or null.
 * Allows https always; http only for localhost and private networks.
 */
export function validateInstanceUrl(raw: string): string | null {
	try {
		const u = new URL(raw);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
		if (!isValidUrlScheme(u)) return null;
		return u.origin;
	} catch {
		return null;
	}
}

/**
 * Parses a syr://login URL and extracts challenge, instance, and callback params.
 * Used for both deep-link handling and QR scan flow.
 * Validates instance and callback: must be valid URLs with safe scheme
 * (https everywhere; http only on localhost and private networks). Callback origin must match instance.
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

		const instance = instanceRaw;
		const callback = callbackRaw;

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

/** Hostnames for challenge-sign flows (export, import, delete-aegis, delete-account). */
const CHALLENGE_SIGN_HOSTNAMES = ['export', 'import', 'delete-aegis', 'delete-account'] as const;

/**
 * Shared parser for syr:// challenge-sign URLs.
 * Returns { challenge, instance, did? } when hostname matches and params are valid.
 */
function parseSyrChallengeSignUrl(
	urlStr: string,
	hostname: (typeof CHALLENGE_SIGN_HOSTNAMES)[number]
): { challenge: string; instance: string; did?: string } | null {
	try {
		const url = new URL(urlStr);
		if (url.protocol !== 'syr:' || url.hostname !== hostname) return null;
		const challenge = url.searchParams.get('challenge');
		const instanceRaw = url.searchParams.get('instance');
		if (!challenge || !instanceRaw) return null;
		const instanceUrl = new URL(instanceRaw);
		if (!isValidUrlScheme(instanceUrl)) return null;
		const did = url.searchParams.get('did') ?? undefined;
		return { challenge, instance: instanceUrl.origin, ...(did ? { did } : {}) };
	} catch {
		// ignore
	}
	return null;
}

/**
 * Parses a syr://export URL.
 * Used for export verification (scan QR to sign challenge).
 */
export function parseSyrExportUrl(
	urlStr: string
): { challenge: string; instance: string; did?: string } | null {
	return parseSyrChallengeSignUrl(urlStr, 'export');
}

/**
 * Parses a syr://import URL.
 * Used for import/migration verification (scan QR to sign challenge).
 */
export function parseSyrImportUrl(
	urlStr: string
): { challenge: string; instance: string; did?: string } | null {
	return parseSyrChallengeSignUrl(urlStr, 'import');
}

/**
 * Parses a syr://delete-aegis URL.
 * Used for delete-aegis verification (scan QR to sign challenge).
 */
export function parseSyrDeleteAegisUrl(
	urlStr: string
): { challenge: string; instance: string; did?: string } | null {
	return parseSyrChallengeSignUrl(urlStr, 'delete-aegis');
}

/**
 * Parses a syr://delete-account URL.
 * Used for delete-account verification (scan QR to sign challenge).
 */
export function parseSyrDeleteAccountUrl(
	urlStr: string
): { challenge: string; instance: string; did?: string } | null {
	return parseSyrChallengeSignUrl(urlStr, 'delete-account');
}

/**
 * Parses any syr:// challenge-sign URL (export, import, delete-aegis, delete-account).
 * All route to the same export-verify flow.
 */
export function parseSyrChallengeSignUrlAny(
	urlStr: string
): { challenge: string; instance: string; did?: string } | null {
	for (const hostname of CHALLENGE_SIGN_HOSTNAMES) {
		const result = parseSyrChallengeSignUrl(urlStr, hostname);
		if (result) return result;
	}
	return null;
}

/**
 * Parses a syr://sync-profile URL.
 * Used when onboarding page shows QR for "Import from Syner".
 * Requires instance and did (no JWT).
 */
export function parseSyrSyncProfileUrl(urlStr: string): { instance: string; did: string } | null {
	try {
		const url = new URL(urlStr);
		if (url.protocol !== 'syr:' || url.hostname !== 'sync-profile') return null;
		const instanceRaw = url.searchParams.get('instance');
		const did = url.searchParams.get('did');
		if (!instanceRaw || !did) return null;
		const instanceUrl = new URL(instanceRaw);
		if (!isValidUrlScheme(instanceUrl)) return null;
		return { instance: instanceRaw, did };
	} catch {
		return null;
	}
}
