/**
 * IndexedDB key storage adapter.
 * Stores private keys in plaintext. Use only in development; prefer Web Crypto adapter in production.
 */

import { generateRootKeypair, generateDeviceKeypair, sign as nobleSign } from '@syr-is/crypto';
import { type KeyRecord, KeyStorageAdapter, PRIVATE_REF } from './types.js';

const DB_NAME = 'syr-identity';
const DB_VERSION = 1;
const STORE_NAME = 'keys';
const META_STORE_NAME = 'meta';

interface StoredRow {
	id: string;
	privateKey: Uint8Array;
	publicKey: Uint8Array;
	type: 'root' | 'device';
	createdAt: string;
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'id' });
			}
			if (!db.objectStoreNames.contains(META_STORE_NAME)) {
				db.createObjectStore(META_STORE_NAME, { keyPath: 'key' });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function createRecord(
	id: string,
	publicKey: Uint8Array,
	type: 'root' | 'device',
	createdAt: string,
	privateKey: Uint8Array
): KeyRecord {
	const record: KeyRecord = {
		id,
		publicKey,
		type,
		createdAt,
		sign: (payload: string | Uint8Array) => nobleSign(payload, privateKey)
	};
	record[PRIVATE_REF] = privateKey;
	return record;
}

export class IndexedDBKeyAdapter extends KeyStorageAdapter {
	async generateRootKeypair(): Promise<KeyRecord> {
		const pair = await generateRootKeypair();
		return createRecord('root', pair.publicKey, 'root', new Date().toISOString(), pair.privateKey);
	}

	async generateDeviceKeypair(): Promise<KeyRecord> {
		const pair = await generateDeviceKeypair();
		// Caller will set record.id to device public key multibase before storeKey
		return createRecord(
			'device',
			pair.publicKey,
			'device',
			new Date().toISOString(),
			pair.privateKey
		);
	}

	async storeKey(record: KeyRecord): Promise<void> {
		const privateKey = record[PRIVATE_REF] as Uint8Array | undefined;
		if (!privateKey || !(privateKey instanceof Uint8Array)) {
			throw new Error('KeyRecord has no private key ref; use a record returned from generate*.');
		}
		const db = await openDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			tx.objectStore(STORE_NAME).put({
				id: record.id,
				privateKey,
				publicKey: record.publicKey,
				type: record.type,
				createdAt: record.createdAt
			} as StoredRow);
			tx.oncomplete = () => {
				db.close();
				resolve();
			};
			tx.onerror = () => {
				db.close();
				reject(tx.error);
			};
		});
	}

	async getKey(id: string): Promise<KeyRecord | null> {
		const db = await openDb();
		const row = await new Promise<StoredRow | undefined>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const req = tx.objectStore(STORE_NAME).get(id);
			req.onsuccess = () => {
				db.close();
				resolve(req.result);
			};
			req.onerror = () => {
				db.close();
				reject(req.error);
			};
		});
		if (!row) return null;
		return createRecord(row.id, row.publicKey, row.type, row.createdAt, row.privateKey);
	}

	async getAllKeys(): Promise<KeyRecord[]> {
		const db = await openDb();
		const rows = await new Promise<StoredRow[]>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const req = tx.objectStore(STORE_NAME).getAll();
			req.onsuccess = () => {
				db.close();
				resolve(req.result ?? []);
			};
			req.onerror = () => {
				db.close();
				reject(req.error);
			};
		});
		return rows.map((r) => createRecord(r.id, r.publicKey, r.type, r.createdAt, r.privateKey));
	}

	async getMeta(key: string): Promise<string | null> {
		const db = await openDb();
		const row = await new Promise<{ value: string } | undefined>((resolve, reject) => {
			const tx = db.transaction(META_STORE_NAME, 'readonly');
			const req = tx.objectStore(META_STORE_NAME).get(key);
			req.onsuccess = () => {
				db.close();
				resolve(req.result);
			};
			req.onerror = () => {
				db.close();
				reject(req.error);
			};
		});
		return row?.value ?? null;
	}

	async setMeta(key: string, value: string): Promise<void> {
		const db = await openDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(META_STORE_NAME, 'readwrite');
			tx.objectStore(META_STORE_NAME).put({ key, value });
			tx.oncomplete = () => {
				db.close();
				resolve();
			};
			tx.onerror = () => {
				db.close();
				reject(tx.error);
			};
		});
	}
}
