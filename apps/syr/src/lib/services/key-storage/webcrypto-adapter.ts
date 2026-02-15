/**
 * Web Crypto key storage adapter.
 * Uses @syr-is/crypto for all key generation and signing. This adapter handles only
 * storage: IndexedDB read/write and envelope encryption (KEK in sessionStorage).
 */

import {
	generateEd25519KeyPairWebCrypto,
	signWithCryptoKey,
	exportPrivateKeyForStorage,
	importPrivateKeyFromStorage,
} from "@syr-is/crypto";
import { type KeyRecord, KeyStorageAdapter, PRIVATE_REF } from "./types.js";

const DB_NAME = "syr-identity-webcrypto";
const DB_VERSION = 1;
const STORE_NAME = "keys";
const META_STORE_NAME = "meta";
const KEK_STORAGE_KEY = "syr-kek";
const IV_LENGTH = 12;
const KEY_LENGTH = 256;

interface StoredRow {
	id: string;
	encryptedPrivateKey: ArrayBuffer;
	publicKey: Uint8Array;
	type: "root" | "device";
	createdAt: string;
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: "id" });
			}
			if (!db.objectStoreNames.contains(META_STORE_NAME)) {
				db.createObjectStore(META_STORE_NAME, { keyPath: "key" });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function getOrCreateKek(): Promise<CryptoKey> {
	const raw = sessionStorage.getItem(KEK_STORAGE_KEY);
	if (raw) {
		const buf = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
		return crypto.subtle.importKey("raw", buf, { name: "AES-GCM" }, false, [
			"encrypt",
			"decrypt",
		]);
	}
	const key = await crypto.subtle.generateKey(
		{ name: "AES-GCM", length: KEY_LENGTH },
		true,
		["encrypt", "decrypt"],
	);
	const exported = await crypto.subtle.exportKey("raw", key);
	sessionStorage.setItem(
		KEK_STORAGE_KEY,
		btoa(String.fromCharCode(...new Uint8Array(exported))),
	);
	return key;
}

async function encryptPrivateKey(
	kek: CryptoKey,
	pkcs8: ArrayBuffer,
): Promise<ArrayBuffer> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const cipher = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		kek,
		pkcs8,
	);
	const combined = new Uint8Array(iv.length + cipher.byteLength);
	combined.set(iv);
	combined.set(new Uint8Array(cipher), iv.length);
	return combined.buffer;
}

async function decryptPrivateKey(
	kek: CryptoKey,
	combined: ArrayBuffer,
): Promise<ArrayBuffer> {
	const arr = new Uint8Array(combined);
	const iv = arr.slice(0, IV_LENGTH);
	const cipher = arr.slice(IV_LENGTH).buffer;
	return crypto.subtle.decrypt({ name: "AES-GCM", iv }, kek, cipher);
}

function createRecord(
	id: string,
	publicKey: Uint8Array,
	type: "root" | "device",
	createdAt: string,
	privateKey: CryptoKey,
): KeyRecord {
	const record: KeyRecord = {
		id,
		publicKey,
		type,
		createdAt,
		sign: (payload: string | Uint8Array) =>
			signWithCryptoKey(payload, privateKey),
	};
	record[PRIVATE_REF] = privateKey;
	return record;
}

export class WebCryptoKeyAdapter extends KeyStorageAdapter {
	async generateRootKeypair(): Promise<KeyRecord> {
		const { publicKey, privateKey } =
			await generateEd25519KeyPairWebCrypto();
		return createRecord(
			"root",
			publicKey,
			"root",
			new Date().toISOString(),
			privateKey,
		);
	}

	async generateDeviceKeypair(): Promise<KeyRecord> {
		const { publicKey, privateKey } =
			await generateEd25519KeyPairWebCrypto();
		return createRecord(
			"device",
			publicKey,
			"device",
			new Date().toISOString(),
			privateKey,
		);
	}

	async storeKey(record: KeyRecord): Promise<void> {
		const privateKey = record[PRIVATE_REF] as CryptoKey | undefined;
		if (!privateKey || !(privateKey instanceof CryptoKey)) {
			throw new Error(
				"KeyRecord has no private key ref; use a record returned from generate*.",
			);
		}
		const pkcs8 = await exportPrivateKeyForStorage(privateKey);
		const kek = await getOrCreateKek();
		const encryptedPrivateKey = await encryptPrivateKey(kek, pkcs8);
		const db = await openDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			tx.objectStore(STORE_NAME).put({
				id: record.id,
				encryptedPrivateKey,
				publicKey: record.publicKey,
				type: record.type,
				createdAt: record.createdAt,
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
			const tx = db.transaction(STORE_NAME, "readonly");
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
		const kek = await getOrCreateKek();
		const pkcs8 = await decryptPrivateKey(kek, row.encryptedPrivateKey);
		const privateKey = await importPrivateKeyFromStorage(pkcs8);
		return createRecord(
			row.id,
			row.publicKey,
			row.type,
			row.createdAt,
			privateKey,
		);
	}

	async getAllKeys(): Promise<KeyRecord[]> {
		const db = await openDb();
		const rows = await new Promise<StoredRow[]>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readonly");
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
		const kek = await getOrCreateKek();
		const out: KeyRecord[] = [];
		for (const row of rows) {
			const pkcs8 = await decryptPrivateKey(kek, row.encryptedPrivateKey);
			const privateKey = await importPrivateKeyFromStorage(pkcs8);
			out.push(
				createRecord(row.id, row.publicKey, row.type, row.createdAt, privateKey),
			);
		}
		return out;
	}

	async getMeta(key: string): Promise<string | null> {
		const db = await openDb();
		const row = await new Promise<{ value: string } | undefined>(
			(resolve, reject) => {
				const tx = db.transaction(META_STORE_NAME, "readonly");
				const req = tx.objectStore(META_STORE_NAME).get(key);
				req.onsuccess = () => {
					db.close();
					resolve(req.result);
				};
				req.onerror = () => {
					db.close();
					reject(req.error);
				};
			},
		);
		return row?.value ?? null;
	}

	async setMeta(key: string, value: string): Promise<void> {
		const db = await openDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(META_STORE_NAME, "readwrite");
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
