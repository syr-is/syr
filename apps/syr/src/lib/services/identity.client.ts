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

const LOG_PREFIX = '[identity.client]';

async function getCurrentDeviceKey() {
	const adp = adapter();
	const currentId = await adp.getMeta('currentDeviceKeyId');
	if (currentId) {
		const key = await adp.getKey(currentId);
		if (key) return key;
		console.warn(
			`${LOG_PREFIX} Device key fallback: currentDeviceKeyId was set but key not found; will try legacy or first available key.`,
			{ currentDeviceKeyId: currentId }
		);
	}
	const legacy = await adp.getKey('device');
	if (legacy) {
		const all = await adp.getAllKeys();
		const deviceKeys = all.filter((k) => k.type === 'device');
		console.warn(`${LOG_PREFIX} Device key fallback: using legacy key id "device".`, {
			attemptedCurrentDeviceKeyId: currentId ?? null,
			selectedKeyId: legacy.id,
			selectedKeyType: legacy.type,
			availableDeviceKeyCount: deviceKeys.length,
			availableDeviceKeyIds: deviceKeys.map((k) => k.id)
		});
		return legacy;
	}
	const all = await adp.getAllKeys();
	const deviceKeys = all.filter((k) => k.type === 'device');
	if (deviceKeys.length > 0) {
		const first = deviceKeys[0]!;
		console.warn(`${LOG_PREFIX} Device key fallback: using first available device key.`, {
			attemptedCurrentDeviceKeyId: currentId ?? null,
			selectedKeyId: first.id,
			selectedKeyType: first.type,
			availableDeviceKeyCount: deviceKeys.length,
			availableDeviceKeyIds: deviceKeys.map((k) => k.id)
		});
		return first;
	}
	return null;
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

	let result: { data?: { did?: string } };
	try {
		result = await response.json();
	} catch {
		throw new Error('Invalid response from identity server: response body is not valid JSON.');
	}
	const confirmedDid =
		result?.data?.did && typeof result.data.did === 'string' ? result.data.did : null;
	if (!confirmedDid) {
		throw new Error(
			'Invalid response from identity server: missing or invalid identity data (did).'
		);
	}

	const persistKeys = async (): Promise<void> => {
		await adp.storeKey(rootRecord);
		deviceRecord.id = devicePubMultibase;
		await adp.storeKey(deviceRecord);
		await adp.setMeta('currentDeviceKeyId', devicePubMultibase);
	};

	const maxAttempts = 2;
	const backoffMs = 200;
	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			await persistKeys();
			return confirmedDid;
		} catch (err) {
			lastError = err;
			if (attempt < maxAttempts) {
				await new Promise((r) => setTimeout(r, backoffMs));
			}
		}
	}

	// Persistence failed; attempt server rollback so identity is not left active without local keys
	try {
		await fetch('/api/identity/rollback', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ did: confirmedDid })
		});
	} catch {
		// Rollback endpoint may not exist or may fail; continue to throw actionable error
	}
	console.warn(
		`${LOG_PREFIX} Local key persistence failed after ${maxAttempts} attempt(s):`,
		lastError
	);
	throw new Error(
		'Identity was created on the server but saving your keys locally failed. ' +
			'Your account may be in an inconsistent state. Please try signing in again or contact support if the problem persists.'
	);
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
 * Add this device as a delegated key to the existing identity.
 * Requires: root key in IndexedDB, user has identity on server.
 */
export async function addDeviceKey(): Promise<string> {
	const adp = adapter();
	const rootKey = await adp.getKey('root');
	if (!rootKey) {
		throw new Error('Root key not found. Import or create identity on a device that has the root key.');
	}

	const { hasIdentity, did } = await checkIdentityStatus();
	if (!hasIdentity || !did) {
		throw new Error('No identity on server. Create identity first.');
	}

	const deviceRecord = await adp.generateDeviceKeypair();
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
	const delegationSignature = await rootKey.sign(canonicalDelegation);
	const delegationSignatureMultibase = encodeMultibase(delegationSignature);

	const response = await fetch('/api/identity/delegate', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			did,
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
		throw new Error(errorData?.message ?? `Add device failed: ${response.status}`);
	}

	deviceRecord.id = devicePubMultibase;
	await adp.storeKey(deviceRecord);
	await adp.setMeta('currentDeviceKeyId', devicePubMultibase);

	return did;
}

/**
 * Check if root key is available locally (can add this device).
 */
export async function hasRootKeyLocally(): Promise<boolean> {
	const rootKey = await adapter().getKey('root');
	return rootKey != null;
}

/**
 * Get the current device's public key as multibase (for comparing with delegated keys list).
 */
export async function getCurrentDevicePublicKeyMultibase(): Promise<string | null> {
	const deviceKey = await getCurrentDeviceKey();
	if (!deviceKey) return null;
	return deviceKey.id.startsWith('z')
		? deviceKey.id
		: encodeMultibase(concatBytes(ED25519_MULTICODEC_PREFIX, deviceKey.publicKey));
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
