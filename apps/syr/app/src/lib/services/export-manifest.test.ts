import { describe, it, expect, beforeAll } from 'vitest';
import {
	initCryptoWasm,
	generateRootKeypair,
	deriveDid,
	createRotationStatement,
	encodeMultibase,
	sign
} from '@syr-is/crypto';
import type { RotationStatement } from '@syr-is/types';
import {
	buildSignedManifestV2,
	buildUnsignedManifestV2,
	verifyBundleTrust,
	MANIFEST_FILENAME
} from './export-manifest';

const enc = new TextEncoder();

/** Multibase root public key embedded in a did:syr string (after the `did:syr:` prefix). */
function pubMultibaseFromDid(did: string): string {
	return did.slice('did:syr:'.length);
}

type Keypair = { publicKey: Uint8Array; privateKey: Uint8Array };

/** Build a minimal, plausible .syr file set (everything except manifest.json). */
function bundleFiles(
	did: string,
	pubMultibase: string,
	chain?: RotationStatement[]
): Record<string, Uint8Array> {
	const identity = {
		did,
		publicKey: pubMultibase,
		didDocument: {},
		delegatedKeys: [],
		profile: { displayName: 'Test' },
		...(chain && chain.length > 0 ? { rotationChain: chain } : {}),
		exportedAt: new Date().toISOString()
	};
	return {
		'identity.json': enc.encode(JSON.stringify(identity, null, 2)),
		'posts.json': enc.encode(JSON.stringify([], null, 2)),
		'assets.json': enc.encode(JSON.stringify({ assets: [] }, null, 2)),
		'pinned_posts.json': enc.encode(JSON.stringify({ post_ids: [] }, null, 2)),
		'assets/pic.bin': new Uint8Array([1, 2, 3, 4, 5])
	};
}

async function signedBundle(
	did: string,
	seed: Uint8Array,
	signingKey: string,
	rotationSeq: number,
	chain?: RotationStatement[]
): Promise<Record<string, Uint8Array>> {
	const files = bundleFiles(did, signingKey, chain);
	const manifest = await buildSignedManifestV2(
		{
			did,
			createdAt: new Date().toISOString(),
			rotationSeq,
			counts: { posts: 0, assets: 0, pinned_posts: 0 },
			files
		},
		seed,
		signingKey
	);
	return { ...files, [MANIFEST_FILENAME]: enc.encode(JSON.stringify(manifest, null, 2)) };
}

describe('export-manifest v2 build + verify', () => {
	let genesis: Keypair;
	let did: string;
	let genesisPub: string;

	beforeAll(async () => {
		await initCryptoWasm();
		genesis = await generateRootKeypair();
		did = deriveDid(genesis.publicKey);
		genesisPub = pubMultibaseFromDid(did);
	});

	it('verifies a signed, non-rotated bundle', async () => {
		const files = await signedBundle(did, genesis.privateKey, genesisPub, 0);
		const result = await verifyBundleTrust(files);
		expect(result.state).toBe('verified');
	});

	it('detects a modified data file (hash mismatch)', async () => {
		const files = await signedBundle(did, genesis.privateKey, genesisPub, 0);
		files['posts.json'] = enc.encode(JSON.stringify([{ evil: true }]));
		const result = await verifyBundleTrust(files);
		expect(result.state).toBe('tampered');
		expect(result.code).toBe('FILE_HASH_MISMATCH');
	});

	it('detects a removed hashed file', async () => {
		const files = await signedBundle(did, genesis.privateKey, genesisPub, 0);
		delete files['assets/pic.bin'];
		const result = await verifyBundleTrust(files);
		expect(result.state).toBe('tampered');
		expect(result.code).toBe('FILE_MISSING');
	});

	it('detects an injected file not covered by the manifest', async () => {
		const files = await signedBundle(did, genesis.privateKey, genesisPub, 0);
		files['assets/injected.bin'] = new Uint8Array([9, 9, 9]);
		const result = await verifyBundleTrust(files);
		expect(result.state).toBe('tampered');
		expect(result.code).toBe('EXTRA_FILE');
	});

	it('detects a broken signature', async () => {
		const files = await signedBundle(did, genesis.privateKey, genesisPub, 0);
		const manifest = JSON.parse(new TextDecoder().decode(files[MANIFEST_FILENAME]));
		// Re-sign the true payload with a different key while keeping the declared signing_key.
		const attacker = await generateRootKeypair();
		manifest.signature.signature = encodeMultibase(
			await sign(manifest.signature.signed_payload_json, attacker.privateKey)
		);
		files[MANIFEST_FILENAME] = enc.encode(JSON.stringify(manifest));
		const result = await verifyBundleTrust(files);
		expect(result.state).toBe('tampered');
		expect(result.code).toBe('SIGNATURE_INVALID');
	});

	it('detects a signing key that is not the chain-resolved root', async () => {
		const files = await signedBundle(did, genesis.privateKey, genesisPub, 0);
		const manifest = JSON.parse(new TextDecoder().decode(files[MANIFEST_FILENAME]));
		const other = await generateRootKeypair();
		manifest.signature.signing_key = pubMultibaseFromDid(deriveDid(other.publicKey));
		files[MANIFEST_FILENAME] = enc.encode(JSON.stringify(manifest));
		const result = await verifyBundleTrust(files);
		expect(result.state).toBe('tampered');
		expect(result.code).toBe('SIGNING_KEY_MISMATCH');
	});

	it('detects a manifest whose content diverges from its signed payload', async () => {
		const files = await signedBundle(did, genesis.privateKey, genesisPub, 0);
		const manifest = JSON.parse(new TextDecoder().decode(files[MANIFEST_FILENAME]));
		// Flip a counter without re-signing: canonical form no longer matches signed_payload_json.
		manifest.counts.posts = 99;
		files[MANIFEST_FILENAME] = enc.encode(JSON.stringify(manifest));
		const result = await verifyBundleTrust(files);
		expect(result.state).toBe('tampered');
		expect(result.code).toBe('CANONICAL_MISMATCH');
	});

	it('detects manifest/identity DID mismatch', async () => {
		const files = await signedBundle(did, genesis.privateKey, genesisPub, 0);
		const other = await generateRootKeypair();
		const otherDid = deriveDid(other.publicKey);
		const identity = JSON.parse(new TextDecoder().decode(files['identity.json']));
		identity.did = otherDid; // identity.json now disagrees with manifest.did
		files['identity.json'] = enc.encode(JSON.stringify(identity, null, 2));
		const result = await verifyBundleTrust(files);
		expect(result.state).toBe('tampered');
		// DID mismatch surfaces before the hash of the mutated identity.json is checked.
		expect(result.code).toBe('MANIFEST_DID_MISMATCH');
	});

	it('verifies a signed, rotated bundle via the embedded chain', async () => {
		const next = await generateRootKeypair();
		const statement = await createRotationStatement(did, 1, next.publicKey, genesis.privateKey);
		const newRootMultibase = statement.newRoot;
		const files = await signedBundle(did, next.privateKey, newRootMultibase, 1, [statement]);
		const result = await verifyBundleTrust(files);
		expect(result.state).toBe('verified');
	});

	it('treats an explicitly-unsigned v2 bundle as legacy_unsigned', async () => {
		const files = bundleFiles(did, genesisPub);
		const manifest = await buildUnsignedManifestV2({
			did,
			createdAt: new Date().toISOString(),
			rotationSeq: 0,
			counts: { posts: 0, assets: 0, pinned_posts: 0 },
			files
		});
		files[MANIFEST_FILENAME] = enc.encode(JSON.stringify(manifest, null, 2));
		const result = await verifyBundleTrust(files);
		expect(result.state).toBe('legacy_unsigned');
	});

	it('treats a legacy v1 manifest as legacy_unsigned', async () => {
		const files = bundleFiles(did, genesisPub);
		files[MANIFEST_FILENAME] = enc.encode(
			JSON.stringify({
				version: 1,
				did,
				exportedAt: new Date().toISOString(),
				postCount: 0,
				assetCount: 0
			})
		);
		const result = await verifyBundleTrust(files);
		expect(result.state).toBe('legacy_unsigned');
	});
});
