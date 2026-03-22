/**
 * Browser-only Sigil signing session: encrypted Sigil JSON in sessionStorage,
 * decrypted seed only in memory until cleared or logout.
 */

import type { SigilObject } from '@syr-is/crypto/sigil';

const KEY_ENC = 'syr.sigilSession.encryptedJson';
const KEY_META = 'syr.sigilSession.meta';

/** Proves decrypted seed matches `sigil.pub` via Ed25519 sign + verify (constant message). */
const SIGIL_SEED_PUB_BINDING_MSG = new TextEncoder().encode('syr:sigil-unlock-binding:v1');

function isValidSigilJson(json: unknown): json is SigilObject {
	if (json == null || typeof json !== 'object') return false;
	const o = json as Record<string, unknown>;
	return 'v' in o && 'kdf' in o && 'enc' in o && 'pub' in o;
}

let unlockedSeed: Uint8Array | null = null;

function clearMemorySeed(): void {
	if (unlockedSeed) {
		unlockedSeed.fill(0);
		unlockedSeed = null;
	}
}

export type SigilSessionStatus = 'empty' | 'loaded_locked' | 'unlocked';

export function getSigilSessionStatus(): SigilSessionStatus {
	if (typeof sessionStorage === 'undefined') return 'empty';
	if (!sessionStorage.getItem(KEY_ENC)) return 'empty';
	if (unlockedSeed) return 'unlocked';
	return 'loaded_locked';
}

export type SigilSessionMeta = { filename: string; loadedAt: string };

export function getSigilSessionMeta(): SigilSessionMeta | null {
	if (typeof sessionStorage === 'undefined') return null;
	const m = sessionStorage.getItem(KEY_META);
	if (!m) return null;
	try {
		return JSON.parse(m) as SigilSessionMeta;
	} catch {
		return null;
	}
}

/**
 * Read encrypted Sigil JSON from sessionStorage and derive DID from embedded public key (no decrypt).
 */
export async function getLoadedSigilDid(): Promise<string | null> {
	if (typeof sessionStorage === 'undefined') return null;
	const raw = sessionStorage.getItem(KEY_ENC);
	if (!raw) return null;
	try {
		const sigil = JSON.parse(raw) as SigilObject;
		if (!isValidSigilJson(sigil)) return null;
		const { initCryptoWasm, decodePublicKey, deriveDid } = await import('@syr-is/crypto');
		await initCryptoWasm();
		const pk = decodePublicKey(sigil.pub);
		return deriveDid(pk);
	} catch {
		return null;
	}
}

/**
 * Ensure encrypted Sigil JSON advertises the given DID (from `pub`). Does not persist.
 * For tests and callers that validate before storage.
 */
export async function assertEncryptedSigilJsonMatchesDid(
	text: string,
	expectedDid: string
): Promise<void> {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error('Invalid Sigil (not JSON)');
	}
	if (!isValidSigilJson(json)) {
		throw new Error('Not a valid encrypted Sigil');
	}
	const exp = expectedDid.trim();
	if (!exp.startsWith('did:syr:')) {
		throw new Error('Invalid expected DID');
	}
	const { initCryptoWasm, decodePublicKey, deriveDid } = await import('@syr-is/crypto');
	await initCryptoWasm();
	const sigil = json as SigilObject;
	const did = deriveDid(decodePublicKey(sigil.pub));
	if (did !== exp) {
		throw new Error(
			'This Sigil is for a different identity than your SYR account. Start a new handoff from Signing settings.'
		);
	}
}

export type LoadSigilFromEncryptedJsonOptions = {
	/** When set (e.g. Syner handoff), refuse to store if `pub` does not derive to this DID. */
	expectedDid?: string;
};

/**
 * Parse and store encrypted Sigil JSON in sessionStorage; clears any in-memory unlock.
 */
export async function loadSigilFromEncryptedJsonText(
	text: string,
	meta: SigilSessionMeta,
	options?: LoadSigilFromEncryptedJsonOptions
): Promise<void> {
	if (options?.expectedDid?.trim()) {
		await assertEncryptedSigilJsonMatchesDid(text, options.expectedDid);
	}
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error('Invalid Sigil (not JSON)');
	}
	if (!isValidSigilJson(json)) {
		throw new Error('Not a valid encrypted Sigil');
	}
	if (typeof sessionStorage === 'undefined') {
		throw new Error('Session storage is not available');
	}
	clearMemorySeed();
	sessionStorage.setItem(KEY_ENC, text);
	sessionStorage.setItem(KEY_META, JSON.stringify(meta));
}

/**
 * Parse and store encrypted Sigil in sessionStorage; clears any in-memory unlock.
 */
export async function loadSigilFromFile(file: File): Promise<void> {
	const text = await file.text();
	await loadSigilFromEncryptedJsonText(text, {
		filename: file.name,
		loadedAt: new Date().toISOString()
	});
}

/**
 * Decrypt loaded Sigil with passphrase; seed kept in memory only.
 */
export async function unlockSigilSession(passphrase: string): Promise<void> {
	if (typeof sessionStorage === 'undefined') {
		throw new Error('Session storage is not available');
	}
	const raw = sessionStorage.getItem(KEY_ENC);
	if (!raw) throw new Error('No Sigil loaded in this session');
	let sigil: SigilObject;
	try {
		const parsed = JSON.parse(raw);
		if (!isValidSigilJson(parsed)) throw new Error('bad');
		sigil = parsed;
	} catch {
		throw new Error('Stored Sigil data is invalid');
	}
	clearMemorySeed();
	const { decryptSigil } = await import('@syr-is/crypto/sigil');
	const { initCryptoWasm, decodePublicKey, sign, verify } = await import('@syr-is/crypto');
	await initCryptoWasm();
	const seed = await decryptSigil(sigil, passphrase);
	if (seed.length !== 32) {
		throw new Error('Invalid decrypted key length');
	}
	const pk = decodePublicKey(sigil.pub);
	const signature = await sign(SIGIL_SEED_PUB_BINDING_MSG, seed);
	const ok = await verify(SIGIL_SEED_PUB_BINDING_MSG, signature, pk);
	if (!ok) {
		seed.fill(0);
		throw new Error(
			'Decrypted key does not match this Sigil public key. The file may be damaged or tampered with.'
		);
	}
	unlockedSeed = seed;
}

/**
 * Remove sessionStorage and zero in-memory seed.
 */
export function clearSigilSession(): void {
	clearMemorySeed();
	if (typeof sessionStorage !== 'undefined') {
		sessionStorage.removeItem(KEY_ENC);
		sessionStorage.removeItem(KEY_META);
	}
}

/**
 * 32-byte Ed25519 seed for signing when session is unlocked; otherwise null.
 * Future signed-mutation UI should use this with `signMutationPayload`.
 */
export function getUnlockedSigningSeed(): Uint8Array | null {
	return unlockedSeed;
}
