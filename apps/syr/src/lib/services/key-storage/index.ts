/**
 * Key storage adapter factory.
 * Uses VITE_KEY_STORAGE_ADAPTER ('indexeddb' | 'webcrypto') to choose implementation.
 * Defaults to 'indexeddb' if unset or invalid.
 */

import type { KeyStorageAdapter } from './types.js';
import { IndexedDBKeyAdapter } from './indexeddb-adapter.js';
import { WebCryptoKeyAdapter } from './webcrypto-adapter.js';

function getAdapterType(): 'webcrypto' | 'indexeddb' {
	if (typeof import.meta === 'undefined' || !import.meta.env?.VITE_KEY_STORAGE_ADAPTER) {
		return 'indexeddb';
	}
	const v = String(import.meta.env.VITE_KEY_STORAGE_ADAPTER).toLowerCase();
	return v === 'webcrypto' ? 'webcrypto' : 'indexeddb';
}

let instance: KeyStorageAdapter | null = null;

/**
 * Returns the key storage adapter singleton. Backend is determined by
 * VITE_KEY_STORAGE_ADAPTER: 'webcrypto' for Web Crypto API (encrypted store),
 * anything else for IndexedDB (plaintext, dev-only). Only call in the browser.
 */
export function getKeyStorageAdapter(): KeyStorageAdapter {
	if (!instance) {
		const type = getAdapterType();
		instance = type === 'webcrypto' ? new WebCryptoKeyAdapter() : new IndexedDBKeyAdapter();
	}
	return instance;
}

export type { KeyRecord, KeyStorageAdapter } from './types.js';
export { IndexedDBKeyAdapter } from './indexeddb-adapter.js';
export { WebCryptoKeyAdapter } from './webcrypto-adapter.js';
