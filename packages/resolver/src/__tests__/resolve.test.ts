import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveDid, resolveProvider } from '../resolve.js';
import {
	generateRootKeypair,
	deriveDid,
	sign,
	canonicalize,
	encodeMultibase
} from '@syr-is/crypto';

async function makeSignedRecord(kp: { publicKey: Uint8Array; privateKey: Uint8Array }) {
	const did = deriveDid(kp.publicKey);
	const provider = 'https://provider.example.com';
	const updatedAt = new Date().toISOString();
	const payload = canonicalize({ did, provider, updatedAt });
	const sig = await sign(payload, kp.privateKey);
	const signature = encodeMultibase(sig);
	return { did, provider, updatedAt, signature };
}

function mockFetchSequence(
	...responses: Array<{ status: number; body?: unknown; ok?: boolean; throws?: boolean }>
) {
	let callIndex = 0;
	return vi.fn(async () => {
		const resp = responses[callIndex++];
		if (!resp) throw new Error('Unexpected fetch call');
		if (resp.throws) throw new Error('Network error');
		return {
			ok: resp.ok ?? (resp.status >= 200 && resp.status < 300),
			status: resp.status,
			statusText: resp.status === 404 ? 'Not Found' : 'OK',
			json: async () => resp.body,
			text: async () => JSON.stringify(resp.body)
		} as unknown as Response;
	});
}

beforeEach(() => {
	vi.restoreAllMocks();
});

describe('resolveDid', () => {
	it('resolves successfully with valid registry response and provider document', async () => {
		const kp = await generateRootKeypair();
		const record = await makeSignedRecord(kp);
		const didDoc = {
			id: record.did,
			verificationMethod: [],
			authentication: [],
			assertionMethod: []
		};

		vi.stubGlobal(
			'fetch',
			mockFetchSequence({ status: 200, body: record }, { status: 200, body: didDoc })
		);

		const doc = await resolveDid(record.did, {
			registryUrl: 'https://registry.example.com'
		});
		expect(doc.id).toBe(record.did);
	});

	it('throws INVALID_DID for malformed DID', async () => {
		await expect(
			resolveDid('did:web:example.com', {
				registryUrl: 'https://registry.example.com'
			})
		).rejects.toThrow('Invalid DID format');
	});

	it('throws NOT_FOUND for 404 registry response', async () => {
		const kp = await generateRootKeypair();
		const did = deriveDid(kp.publicKey);

		vi.stubGlobal('fetch', mockFetchSequence({ status: 404 }));

		await expect(resolveDid(did, { registryUrl: 'https://registry.example.com' })).rejects.toThrow(
			'not found in registry'
		);
	});

	it('throws INVALID_SIGNATURE when hosting record signature fails', async () => {
		const kp = await generateRootKeypair();
		const record = await makeSignedRecord(kp);
		// Tamper with the provider to invalidate the signature
		const tampered = { ...record, provider: 'https://evil.example.com' };

		vi.stubGlobal('fetch', mockFetchSequence({ status: 200, body: tampered }));

		await expect(
			resolveDid(record.did, { registryUrl: 'https://registry.example.com' })
		).rejects.toThrow('signature verification failed');
	});

	it('throws PROVIDER_UNREACHABLE when provider fetch fails', async () => {
		const kp = await generateRootKeypair();
		const record = await makeSignedRecord(kp);

		vi.stubGlobal(
			'fetch',
			mockFetchSequence({ status: 200, body: record }, { status: 200, body: record, throws: true })
		);

		// The second fetch (provider) throws
		let callCount = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string) => {
				callCount++;
				if (callCount === 1) {
					return { ok: true, status: 200, json: async () => record } as unknown as Response;
				}
				throw new Error('Network error');
			})
		);

		await expect(
			resolveDid(record.did, { registryUrl: 'https://registry.example.com' })
		).rejects.toThrow('Provider unreachable');
	});

	it('throws INVALID_DOCUMENT when DID document id mismatches', async () => {
		const kp = await generateRootKeypair();
		const record = await makeSignedRecord(kp);
		const wrongDoc = { id: 'did:syr:zWrongDID', verificationMethod: [] };

		vi.stubGlobal(
			'fetch',
			mockFetchSequence({ status: 200, body: record }, { status: 200, body: wrongDoc })
		);

		await expect(
			resolveDid(record.did, { registryUrl: 'https://registry.example.com' })
		).rejects.toThrow('DID Document id mismatch');
	});
});

describe('resolveProvider', () => {
	it('returns just the provider URL', async () => {
		const kp = await generateRootKeypair();
		const record = await makeSignedRecord(kp);

		vi.stubGlobal('fetch', mockFetchSequence({ status: 200, body: record }));

		const provider = await resolveProvider(record.did, {
			registryUrl: 'https://registry.example.com'
		});
		expect(provider).toBe('https://provider.example.com');
	});

	it('throws INVALID_DID for malformed DID', async () => {
		await expect(
			resolveProvider('not-a-did', {
				registryUrl: 'https://registry.example.com'
			})
		).rejects.toThrow('Invalid DID format');
	});

	it('throws NOT_FOUND for 404', async () => {
		const kp = await generateRootKeypair();
		const did = deriveDid(kp.publicKey);

		vi.stubGlobal('fetch', mockFetchSequence({ status: 404 }));

		await expect(
			resolveProvider(did, { registryUrl: 'https://registry.example.com' })
		).rejects.toThrow('not found in registry');
	});
});
