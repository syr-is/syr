export type PostContentConsent = {
	mode: 'all_for_snapshot' | 'urls';
	urls?: string[];
	contentVersion: string;
	at: number;
};

function consentKey(did: string, localId: string): string {
	return `syr:post-content-consent:${did}:${localId}`;
}

export function readPostContentConsent(
	storage: Storage,
	did: string,
	localId: string
): PostContentConsent | null {
	try {
		const raw = storage.getItem(consentKey(did, localId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as PostContentConsent;
		if (
			parsed &&
			(parsed.mode === 'all_for_snapshot' || parsed.mode === 'urls') &&
			typeof parsed.contentVersion === 'string' &&
			typeof parsed.at === 'number'
		) {
			return parsed;
		}
	} catch {
		// ignore
	}
	return null;
}

export function writePostContentConsent(
	storage: Storage,
	did: string,
	localId: string,
	consent: PostContentConsent
): void {
	storage.setItem(consentKey(did, localId), JSON.stringify(consent));
}

export function clearPostContentConsent(storage: Storage, did: string, localId: string): void {
	storage.removeItem(consentKey(did, localId));
}

/** Prefer localStorage when logged in; sessionStorage when anonymous. */
export function consentStorageForSession(persist: boolean): Storage {
	if (typeof window === 'undefined') {
		throw new Error('consentStorageForSession requires a browser');
	}
	return persist ? localStorage : sessionStorage;
}
