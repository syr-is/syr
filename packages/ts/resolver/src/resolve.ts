import { verify, canonicalize, decodeMultibase } from '@syr-is/crypto';
import { parseDid, isValidSyrDid } from '@syr-is/did';
import type { DidDocument } from '@syr-is/did';
import type { HostingRecord, ResolverOptions } from './types.js';
import { ResolverError } from './types.js';

/**
 * Resolve a did:syr identifier to a DID Document.
 *
 * Steps:
 * 1. Validate the DID format
 * 2. Query the registry for the hosting record
 * 3. Verify the hosting record signature against the DID's public key
 * 4. Fetch the DID Document from the resolved provider
 *
 * @param did - Full did:syr identifier (e.g. "did:syr:z6Mk...")
 * @param options - Resolver configuration (registry URL, timeout)
 * @returns The verified DID Document
 * @throws {ResolverError} On invalid DID, missing record, bad signature, or unreachable provider
 */
export async function resolveDid(did: string, options: ResolverOptions): Promise<DidDocument> {
	// 1. Validate DID format
	if (!isValidSyrDid(did)) {
		throw new ResolverError(`Invalid DID format: ${did}`, 'INVALID_DID');
	}

	const { registryUrl, timeout = 10000 } = options;

	// 2. Query registry for hosting record
	const registryResponse = await fetchWithTimeout(
		`${registryUrl}/resolve/${encodeURIComponent(did)}`,
		timeout
	);

	if (registryResponse.status === 404) {
		throw new ResolverError(`DID not found in registry: ${did}`, 'NOT_FOUND');
	}

	if (!registryResponse.ok) {
		throw new ResolverError(
			`Registry error: ${registryResponse.status} ${registryResponse.statusText}`,
			'NOT_FOUND'
		);
	}

	const record: HostingRecord = await registryResponse.json();

	// 3. Verify the hosting record signature
	const parsed = parseDid(did);
	const payload = canonicalize({
		did: record.did,
		provider: record.provider,
		updatedAt: record.updatedAt
	});

	const signatureBytes = decodeMultibase(record.signature);
	const isValid = await verify(payload, signatureBytes, parsed.publicKey);

	if (!isValid) {
		throw new ResolverError(
			`Hosting record signature verification failed for ${did}`,
			'INVALID_SIGNATURE'
		);
	}

	// 4. Fetch DID Document from the provider
	const documentUrl = `${record.provider}/api/identity/${encodeURIComponent(did)}/document`;
	let documentResponse: Response;

	try {
		documentResponse = await fetchWithTimeout(documentUrl, timeout);
	} catch {
		throw new ResolverError(`Provider unreachable at ${record.provider}`, 'PROVIDER_UNREACHABLE');
	}

	if (!documentResponse.ok) {
		throw new ResolverError(
			`Provider returned ${documentResponse.status} for DID Document`,
			'PROVIDER_UNREACHABLE'
		);
	}

	const document: DidDocument = await documentResponse.json();

	// Basic validation: DID in document must match requested DID
	if (document.id !== did) {
		throw new ResolverError(
			`DID Document id mismatch: expected ${did}, got ${document.id}`,
			'INVALID_DOCUMENT'
		);
	}

	return document;
}

/**
 * Resolve a DID to just the provider URL (skip fetching the full document).
 * Useful when you just need to know where an identity is hosted.
 */
export async function resolveProvider(did: string, options: ResolverOptions): Promise<string> {
	if (!isValidSyrDid(did)) {
		throw new ResolverError(`Invalid DID format: ${did}`, 'INVALID_DID');
	}

	const { registryUrl, timeout = 10000 } = options;

	const response = await fetchWithTimeout(
		`${registryUrl}/resolve/${encodeURIComponent(did)}`,
		timeout
	);

	if (response.status === 404) {
		throw new ResolverError(`DID not found in registry: ${did}`, 'NOT_FOUND');
	}

	if (!response.ok) {
		throw new ResolverError(`Registry error: ${response.status}`, 'NOT_FOUND');
	}

	const record: HostingRecord = await response.json();

	// Verify signature
	const parsed = parseDid(did);
	const payload = canonicalize({
		did: record.did,
		provider: record.provider,
		updatedAt: record.updatedAt
	});
	const signatureBytes = decodeMultibase(record.signature);
	const isValid = await verify(payload, signatureBytes, parsed.publicKey);

	if (!isValid) {
		throw new ResolverError(
			`Hosting record signature verification failed for ${did}`,
			'INVALID_SIGNATURE'
		);
	}

	return record.provider;
}

/**
 * Fetch with a timeout using AbortController.
 */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		return await fetch(url, { signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}
