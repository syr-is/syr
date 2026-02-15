/**
 * Key storage adapter types.
 * Abstracts over IndexedDB (plaintext) and Web Crypto API (non-extractable / encrypted).
 */

/** Symbol used by adapters to attach the private key ref to a KeyRecord for persistence. */
export const PRIVATE_REF = Symbol.for('syr.KeyRecord.privateRef') as symbol;

/**
 * A key record that can be used for signing. The private key is never exposed;
 * the adapter holds it and performs sign via the record's sign() method.
 * Adapters may set record[PRIVATE_REF] for use in storeKey(); consumers must not read it.
 */
export interface KeyRecord {
	id: string;
	publicKey: Uint8Array;
	type: 'root' | 'device';
	createdAt: string;
	sign(payload: string | Uint8Array): Promise<Uint8Array>;
	[PRIVATE_REF]?: unknown;
}

/**
 * Abstract key storage adapter. Implementations use either IndexedDB (plaintext)
 * or Web Crypto API (non-extractable keys, encrypted persistence).
 */
export abstract class KeyStorageAdapter {
	/** Generate a new root keypair. Caller must call storeKey after to persist. */
	abstract generateRootKeypair(): Promise<KeyRecord>;

	/** Generate a new device keypair. Caller must call storeKey after to persist. */
	abstract generateDeviceKeypair(): Promise<KeyRecord>;

	/** Persist a key record. Must be called with a record returned from generate*. */
	abstract storeKey(record: KeyRecord): Promise<void>;

	/** Load a key by id. Returns null if not found. */
	abstract getKey(id: string): Promise<KeyRecord | null>;

	/** Load all stored keys. */
	abstract getAllKeys(): Promise<KeyRecord[]>;

	/** Read a meta value (e.g. currentDeviceKeyId). */
	abstract getMeta(key: string): Promise<string | null>;

	/** Write a meta value. */
	abstract setMeta(key: string, value: string): Promise<void>;
}
