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
		return { challenge, instance: instanceRaw, ...(did ? { did } : {}) };
	} catch {
		// ignore
	}
	return null;
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
/**
 * syr://sigil-handoff?origin=...&session=...&did=...&nonce=...
 * Requesting web app origin for Sigil file export (encrypted .sigil only; no plaintext keys on the wire).
 * `session` ties to a server-side handoff slot when using SYR Settings → Signing “Receive from Syner”.
 * Validation of ciphertext happens in the SYR browser after upload, not in Syner.
 */
/**
 * syr://post-sign?origin=...&session=...&did=...
 * Syner signs a pending post@v1 payload for the SYR browser tab.
 */
/**
 * syr://registry-sign?origin=...&session=...&did=...
 * Syner signs a pending publication registry sync for the SYR browser tab.
 */
export function parseSyrRegistrySignUrl(urlStr: string): {
	origin: string;
	session: string;
	expectedDid: string;
} | null {
	try {
		const url = new URL(urlStr);
		if (url.protocol !== 'syr:' || url.hostname !== 'registry-sign') return null;
		const originRaw = url.searchParams.get('origin');
		if (!originRaw) return null;
		const ou = new URL(originRaw);
		if (!isValidUrlScheme(ou)) return null;
		const session = url.searchParams.get('session')?.trim();
		const expectedDid = url.searchParams.get('did')?.trim() ?? '';
		if (!session || !expectedDid.startsWith('did:syr:')) {
			return null;
		}
		return { origin: ou.origin, session, expectedDid };
	} catch {
		return null;
	}
}

export function parseSyrPostSignUrl(urlStr: string): {
	origin: string;
	session: string;
	expectedDid: string;
} | null {
	try {
		const url = new URL(urlStr);
		if (url.protocol !== 'syr:' || url.hostname !== 'post-sign') return null;
		const originRaw = url.searchParams.get('origin');
		if (!originRaw) return null;
		const ou = new URL(originRaw);
		if (!isValidUrlScheme(ou)) return null;
		const session = url.searchParams.get('session')?.trim();
		const expectedDid = url.searchParams.get('did')?.trim() ?? '';
		if (!session || !expectedDid.startsWith('did:syr:')) {
			return null;
		}
		return { origin: ou.origin, session, expectedDid };
	} catch {
		return null;
	}
}

export function parseSyrSigilHandoffUrl(urlStr: string): {
	origin: string;
	nonce?: string;
	session: string;
	expectedDid: string;
} | null {
	try {
		const url = new URL(urlStr);
		if (url.protocol !== 'syr:' || url.hostname !== 'sigil-handoff') return null;
		const originRaw = url.searchParams.get('origin');
		if (!originRaw) return null;
		const ou = new URL(originRaw);
		if (!isValidUrlScheme(ou)) return null;
		const session = url.searchParams.get('session')?.trim();
		const expectedDid = url.searchParams.get('did')?.trim() ?? '';
		if (!session || !expectedDid.startsWith('did:syr:')) {
			return null;
		}
		const nonce = url.searchParams.get('nonce') ?? undefined;
		return { origin: ou.origin, nonce, session, expectedDid };
	} catch {
		return null;
	}
}

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

/**
 * Map a scanned or deep-linked `syr://…` URL to an in-app path + query.
 * Keeps QR scan and `syr://` OS handlers aligned.
 */
export function syrUrlToInternalRoute(urlStr: string): string | null {
	const trimmed = urlStr.trim();
	const loginParsed = parseSyrLoginUrl(trimmed);
	if (loginParsed) {
		return `/scan-confirm?${new URLSearchParams(loginParsed)}`;
	}
	const challengeSignParsed = parseSyrChallengeSignUrlAny(trimmed);
	if (challengeSignParsed) {
		return `/export-verify?${new URLSearchParams(challengeSignParsed)}`;
	}
	const syncParsed = parseSyrSyncProfileUrl(trimmed);
	if (syncParsed) {
		return `/sync-profile?${new URLSearchParams(syncParsed)}`;
	}
	const sigilParsed = parseSyrSigilHandoffUrl(trimmed);
	if (sigilParsed) {
		const q = new URLSearchParams();
		q.set('origin', sigilParsed.origin);
		q.set('session', sigilParsed.session);
		q.set('did', sigilParsed.expectedDid);
		if (sigilParsed.nonce) q.set('nonce', sigilParsed.nonce);
		return `/sigil-handoff?${q.toString()}`;
	}
	const postSignParsed = parseSyrPostSignUrl(trimmed);
	if (postSignParsed) {
		const q = new URLSearchParams();
		q.set('origin', postSignParsed.origin);
		q.set('session', postSignParsed.session);
		q.set('did', postSignParsed.expectedDid);
		return `/post-sign?${q.toString()}`;
	}
	const registrySignParsed = parseSyrRegistrySignUrl(trimmed);
	if (registrySignParsed) {
		const q = new URLSearchParams();
		q.set('origin', registrySignParsed.origin);
		q.set('session', registrySignParsed.session);
		q.set('did', registrySignParsed.expectedDid);
		return `/registry-sign?${q.toString()}`;
	}
	return null;
}
