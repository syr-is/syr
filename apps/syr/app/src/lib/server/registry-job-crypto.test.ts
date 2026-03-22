import { describe, it, expect, beforeAll } from 'vitest';
import { initCryptoWasm, generateRootKeypair, sign, encodeMultibase } from '@syr-is/crypto';
import {
	canonicalStringForDirectoryUpsert,
	canonicalStringForRegistryDelete,
	canonicalStringForRegistryUpdate,
	verifyRegistryRootSignature
} from './registry-job-crypto';

beforeAll(async () => {
	await initCryptoWasm();
});

describe('registry-job-crypto', () => {
	it('canonicalStringForRegistryUpdate is stable and verifies with root key', async () => {
		const kp = await generateRootKeypair();
		const updatedAt = '2025-03-21T12:00:00.000Z';
		const did = 'did:syr:test';
		const provider = 'https://syr.example/';
		const canonical = canonicalStringForRegistryUpdate({ did, provider, updatedAt });
		expect(canonical.length).toBeGreaterThan(10);
		const sig = await sign(canonical, kp.privateKey);
		const mb = encodeMultibase(sig);
		const pkMb = encodeMultibase(new Uint8Array([0xed, 0x01, ...kp.publicKey]));
		const ok = await verifyRegistryRootSignature(canonical, mb, pkMb);
		expect(ok).toBe(true);
	});

	it('canonicalStringForRegistryDelete verifies', async () => {
		const kp = await generateRootKeypair();
		const deletedAt = '2025-03-21T12:00:00.000Z';
		const did = 'did:syr:test2';
		const canonical = canonicalStringForRegistryDelete({ did, deletedAt });
		const sig = await sign(canonical, kp.privateKey);
		const mb = encodeMultibase(sig);
		const pkMb = encodeMultibase(new Uint8Array([0xed, 0x01, ...kp.publicKey]));
		const ok = await verifyRegistryRootSignature(canonical, mb, pkMb);
		expect(ok).toBe(true);
	});

	it('canonicalStringForDirectoryUpsert verifies with root key', async () => {
		const kp = await generateRootKeypair();
		const updatedAt = '2025-03-21T12:00:00.000Z';
		const canonical = canonicalStringForDirectoryUpsert({
			did: 'did:syr:testdir',
			provider: 'https://syr.example/',
			username: 'alice',
			displayName: 'Alice',
			listed: true,
			updatedAt
		});
		const sig = await sign(canonical, kp.privateKey);
		const mb = encodeMultibase(sig);
		const pkMb = encodeMultibase(new Uint8Array([0xed, 0x01, ...kp.publicKey]));
		const ok = await verifyRegistryRootSignature(canonical, mb, pkMb);
		expect(ok).toBe(true);
	});

	it('verifyRegistryRootSignature rejects wrong key', async () => {
		const kp1 = await generateRootKeypair();
		const kp2 = await generateRootKeypair();
		const canonical = canonicalStringForRegistryDelete({
			did: 'did:syr:x',
			deletedAt: '2025-01-01T00:00:00.000Z'
		});
		const sig = await sign(canonical, kp1.privateKey);
		const mb = encodeMultibase(sig);
		const pkMbWrong = encodeMultibase(new Uint8Array([0xed, 0x01, ...kp2.publicKey]));
		const ok = await verifyRegistryRootSignature(canonical, mb, pkMbWrong);
		expect(ok).toBe(false);
	});
});
