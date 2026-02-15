/**
 * Client-side identity service.
 * Handles key generation, IndexedDB storage, delegation creation,
 * and communication with the identity API endpoints.
 *
 * This module runs in the browser only.
 */

import {
	generateRootKeypair,
	generateDeviceKeypair,
	deriveDid,
	encodeMultibase,
	sign,
	canonicalize,
	ED25519_MULTICODEC_PREFIX
} from '@syr-is/crypto';

// ── IndexedDB Key Storage ──────────────────────────────────────────────

const DB_NAME = 'syr-identity';
const DB_VERSION = 1;
const STORE_NAME = 'keys';

interface StoredKey {
	id: string;
	privateKey: Uint8Array;
	publicKey: Uint8Array;
	type: 'root' | 'device';
	createdAt: string;
}

function openKeyStore(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'id' });
			}
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function storeKey(key: StoredKey): Promise<void> {
	const db = await openKeyStore();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite');
		const store = tx.objectStore(STORE_NAME);
		store.put(key);
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

async function getKey(id: string): Promise<StoredKey | null> {
	const db = await openKeyStore();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readonly');
		const store = tx.objectStore(STORE_NAME);
		const request = store.get(id);
		request.onsuccess = () => {
			db.close();
			resolve(request.result ?? null);
		};
		request.onerror = () => {
			db.close();
			reject(request.error);
		};
	});
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Check if the current user has an identity on the server.
 */
export async function checkIdentityStatus(): Promise<{ hasIdentity: boolean; did: string | null }> {
	const response = await fetch('/api/identity/status');
	if (!response.ok) {
		throw new Error('Failed to check identity status');
	}
	const result = await response.json();
	return result.data;
}

/**
 * Create a new identity for the current user.
 *
 * Steps:
 * 1. Generate root keypair (Ed25519)
 * 2. Derive DID from root public key
 * 3. Generate device keypair (Ed25519)
 * 4. Create delegation statement signed by root key
 * 5. Store both private keys in IndexedDB
 * 6. POST to /api/identity/init
 *
 * @returns The DID of the newly created identity
 */
export async function createIdentity(): Promise<string> {
	// 1. Generate root keypair
	const rootKeypair = await generateRootKeypair();
	const did = deriveDid(rootKeypair.publicKey);

	// 2. Generate device keypair
	const deviceKeypair = await generateDeviceKeypair();

	// 3. Encode public keys as multibase (with multicodec prefix for root)
	const rootPubMultibase = encodeMultibase(
		concatBytes(ED25519_MULTICODEC_PREFIX, rootKeypair.publicKey)
	);
	const devicePubMultibase = encodeMultibase(
		concatBytes(ED25519_MULTICODEC_PREFIX, deviceKeypair.publicKey)
	);

	// 4. Create and sign delegation statement
	const createdAt = new Date().toISOString();
	const delegationStatement = {
		did,
		delegate: devicePubMultibase,
		scope: 'device' as const,
		createdAt
	};
	const canonicalDelegation = canonicalize(delegationStatement);
	const delegationSignature = await sign(canonicalDelegation, rootKeypair.privateKey);
	const delegationSignatureMultibase = encodeMultibase(delegationSignature);

	// 5. Store keys in IndexedDB
	await storeKey({
		id: 'root',
		privateKey: rootKeypair.privateKey,
		publicKey: rootKeypair.publicKey,
		type: 'root',
		createdAt
	});
	await storeKey({
		id: 'device',
		privateKey: deviceKeypair.privateKey,
		publicKey: deviceKeypair.publicKey,
		type: 'device',
		createdAt
	});

	// 6. POST to server
	const response = await fetch('/api/identity/init', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			did,
			publicKey: rootPubMultibase,
			devicePublicKey: devicePubMultibase,
			delegation: {
				did,
				delegate: devicePubMultibase,
				scope: 'device',
				createdAt,
				signature: delegationSignatureMultibase
			}
		})
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => null);
		throw new Error(
			errorData?.message ?? `Identity initialization failed: ${response.status}`
		);
	}

	const result = await response.json();
	return result.data.did;
}

/**
 * Sign a mutation payload with the device key.
 *
 * @param payload - The mutation data to sign
 * @returns Object with signature and devicePublicKey (both multibase-encoded)
 */
export async function signMutation(
	payload: Record<string, unknown>
): Promise<{ signature: string; devicePublicKey: string }> {
	const deviceKey = await getKey('device');
	if (!deviceKey) {
		throw new Error('No device key found. Identity may not be initialized.');
	}

	const canonicalPayload = canonicalize(payload);
	const signatureBytes = await sign(canonicalPayload, deviceKey.privateKey);
	const signature = encodeMultibase(signatureBytes);
	const devicePublicKey = encodeMultibase(
		concatBytes(ED25519_MULTICODEC_PREFIX, deviceKey.publicKey)
	);

	return { signature, devicePublicKey };
}

/**
 * Get the locally stored root public key (if available).
 */
export async function getLocalRootPublicKey(): Promise<Uint8Array | null> {
	const rootKey = await getKey('root');
	return rootKey?.publicKey ?? null;
}

/**
 * Get the locally stored device public key (if available).
 */
export async function getLocalDevicePublicKey(): Promise<Uint8Array | null> {
	const deviceKey = await getKey('device');
	return deviceKey?.publicKey ?? null;
}

// ── Helpers ────────────────────────────────────────────────────────────

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
	let totalLength = 0;
	for (const arr of arrays) totalLength += arr.length;
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const arr of arrays) {
		result.set(arr, offset);
		offset += arr.length;
	}
	return result;
}
