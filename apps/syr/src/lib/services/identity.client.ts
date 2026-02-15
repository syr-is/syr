/**
 * Client-side identity service.
 * Handles key generation (via key-storage adapter), delegation creation,
 * and communication with the identity API endpoints.
 *
 * This module runs in the browser only. Key storage backend is chosen by
 * VITE_KEY_STORAGE_ADAPTER: 'indexeddb' (plaintext, dev) or 'webcrypto' (encrypted).
 */

import {
	deriveDid,
	encodeMultibase,
	canonicalize,
	ED25519_MULTICODEC_PREFIX
} from '@syr-is/crypto';
import { getKeyStorageAdapter } from '$lib/services/key-storage/index.js';

/** Lazy so this module can be loaded on server; adapter is used only in browser. */
function adapter() {
	return getKeyStorageAdapter();
}

// ── Helpers ────────────────────────────────────────────────────────────────

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

async function getCurrentDeviceKey() {
	const adp = adapter();
	const currentId = await adp.getMeta('currentDeviceKeyId');
	if (currentId) {
		const key = await adp.getKey(currentId);
		if (key) return key;
	}
	const legacy = await adp.getKey('device');
	if (legacy) return legacy;
	const all = await adp.getAllKeys();
	const deviceKeys = all.filter((k) => k.type === 'device');
	return deviceKeys.length > 0 ? deviceKeys[0]! : null;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Check if the current user has an identity on the server.
 */
export async function checkIdentityStatus(): Promise<{
	hasIdentity: boolean;
	did: string | null;
}> {
	const response = await fetch('/api/identity/status');
	if (!response.ok) {
		throw new Error('Failed to check identity status');
	}
	const result = await response.json();
	return result.data;
}

/**
 * Create a new identity for the current user.
 * Uses the configured key-storage adapter (IndexedDB or Web Crypto).
 */
export async function createIdentity(): Promise<string> {
	const adp = adapter();
	const rootRecord = await adp.generateRootKeypair();
	const did = deriveDid(rootRecord.publicKey);

	const deviceRecord = await adp.generateDeviceKeypair();
	const rootPubMultibase = encodeMultibase(
		concatBytes(ED25519_MULTICODEC_PREFIX, rootRecord.publicKey)
	);
	const devicePubMultibase = encodeMultibase(
		concatBytes(ED25519_MULTICODEC_PREFIX, deviceRecord.publicKey)
	);

	const createdAt = new Date().toISOString();
	const delegationStatement = {
		did,
		delegate: devicePubMultibase,
		scope: 'device' as const,
		createdAt
	};
	const canonicalDelegation = canonicalize(delegationStatement);
	const delegationSignature = await rootRecord.sign(canonicalDelegation);
	const delegationSignatureMultibase = encodeMultibase(delegationSignature);

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
		throw new Error(errorData?.message ?? `Identity initialization failed: ${response.status}`);
	}

	const result = await response.json();

	await adp.storeKey(rootRecord);
	deviceRecord.id = devicePubMultibase;
	await adp.storeKey(deviceRecord);
	await adp.setMeta('currentDeviceKeyId', devicePubMultibase);

	return result.data.did;
}

/**
 * Sign a mutation payload with the device key.
 */
export async function signMutation(
	payload: Record<string, unknown>
): Promise<{ signature: string; devicePublicKey: string }> {
	const deviceKey = await getCurrentDeviceKey();
	if (!deviceKey) {
		throw new Error('No device key found. Identity may not be initialized.');
	}

	const canonicalPayload = canonicalize(payload);
	const signatureBytes = await deviceKey.sign(canonicalPayload);
	const signature = encodeMultibase(signatureBytes);
	const devicePublicKey = deviceKey.id.startsWith('z')
		? deviceKey.id
		: encodeMultibase(concatBytes(ED25519_MULTICODEC_PREFIX, deviceKey.publicKey));

	return { signature, devicePublicKey };
}

/**
 * Get the locally stored root public key (if available).
 */
export async function getLocalRootPublicKey(): Promise<Uint8Array | null> {
	const rootKey = await adapter().getKey('root');
	return rootKey?.publicKey ?? null;
}

/**
 * Get the locally stored device public key (if available).
 */
export async function getLocalDevicePublicKey(): Promise<Uint8Array | null> {
	const deviceKey = await getCurrentDeviceKey();
	return deviceKey?.publicKey ?? null;
}
