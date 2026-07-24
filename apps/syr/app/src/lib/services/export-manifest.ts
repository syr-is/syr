/**
 * `.syr` bundle manifest v2 — build and verification.
 *
 * A v2 manifest hashes every file in the bundle (except manifest.json, which cannot
 * hash itself) and, for custodial/device-signed exports, carries an Ed25519
 * signature over the RFC 8785 JCS canonical form of the manifest (sans its own
 * signature block), made with the ROOT key that is current at export time. The
 * bundle also embeds the full rotation chain (identity.json `rotationChain`) so an
 * importer can resolve that current root without the exporter's local state.
 *
 * This module is isomorphic: the export dialog builds manifests in the browser and
 * both the import dialog (browser) and the import service (server) verify them here,
 * so tamper-detection is identical on both sides. Rust is the crypto source of
 * truth — we only compose primitives from `@syr-is/crypto` / `@syr-is/utils`.
 */
import {
	initCryptoWasm,
	canonicalize,
	sign,
	verify,
	encodeMultibase,
	decodeMultibase,
	decodePublicKey,
	constantTimeEqual,
	verifyRotationChain
} from '@syr-is/crypto';
import { computeSha256Hex } from '@syr-is/utils';
import {
	IdentityExportManifestV2Schema,
	type IdentityExportManifestV2,
	type ExportManifestCounts,
	type RotationStatement
} from '@syr-is/types';

/** The one file whose hash is structurally excluded from a manifest's `files` map. */
export const MANIFEST_FILENAME = 'manifest.json';

/** View a Uint8Array as a standalone ArrayBuffer (handles subarray views). */
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
	return u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength
		? (u8.buffer as ArrayBuffer)
		: (u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer);
}

/**
 * SHA-256 (hex) of every bundle file, keyed by bundle-relative path. `manifest.json`
 * is skipped defensively; callers pass the file set without it.
 */
export async function computeBundleFileHashes(
	files: Record<string, Uint8Array>
): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const [path, bytes] of Object.entries(files)) {
		if (path === MANIFEST_FILENAME) continue;
		out[path] = await computeSha256Hex(toArrayBuffer(bytes));
	}
	return out;
}

type ManifestCoreFields = {
	did: string;
	created_at: string;
	rotation_seq: number;
	counts: ExportManifestCounts;
	files: Record<string, string>;
};

/**
 * The single source of truth for the signed byte string: the exact JCS canonical
 * form of the manifest minus its signature block. Build signs this; verify
 * re-derives it and byte-compares against the stored `signed_payload_json`.
 */
function signableManifestString(fields: ManifestCoreFields): string {
	return canonicalize({
		format_version: 2,
		did: fields.did,
		created_at: fields.created_at,
		rotation_seq: fields.rotation_seq,
		counts: {
			posts: fields.counts.posts,
			assets: fields.counts.assets,
			pinned_posts: fields.counts.pinned_posts
		},
		files: fields.files
	});
}

export type BuildManifestInput = {
	did: string;
	/** ISO-8601 export timestamp. */
	createdAt: string;
	/** Rotation-chain length at export time (0 when never rotated). */
	rotationSeq: number;
	counts: ExportManifestCounts;
	/** Every file that goes into the bundle EXCEPT manifest.json. */
	files: Record<string, Uint8Array>;
};

/**
 * Build a signed manifest v2. `seed` is the 32-byte root private-key seed (available
 * inside the custodial unlock scope or the device signer); `signingKeyMultibase` is
 * the multibase root public key current at export time (identity.publicKey).
 */
export async function buildSignedManifestV2(
	input: BuildManifestInput,
	seed: Uint8Array,
	signingKeyMultibase: string
): Promise<IdentityExportManifestV2> {
	await initCryptoWasm();
	const files = await computeBundleFileHashes(input.files);
	const core: ManifestCoreFields = {
		did: input.did,
		created_at: input.createdAt,
		rotation_seq: input.rotationSeq,
		counts: input.counts,
		files
	};
	const signedPayloadJson = signableManifestString(core);
	const signature = encodeMultibase(await sign(signedPayloadJson, seed));
	return {
		format_version: 2,
		did: core.did,
		created_at: core.created_at,
		rotation_seq: core.rotation_seq,
		counts: {
			posts: core.counts.posts,
			assets: core.counts.assets,
			pinned_posts: core.counts.pinned_posts
		},
		files,
		signature: {
			signed_payload_json: signedPayloadJson,
			signature,
			signing_key: signingKeyMultibase
		}
	};
}

/**
 * Build an explicitly-unsigned manifest v2. Integrity (file hashes) is self-consistent
 * but authenticity is NOT verifiable — used only where the signer round cannot yet
 * carry the manifest payload (self-custody data-only exports).
 */
export async function buildUnsignedManifestV2(
	input: BuildManifestInput
): Promise<IdentityExportManifestV2> {
	const files = await computeBundleFileHashes(input.files);
	return {
		format_version: 2,
		did: input.did,
		created_at: input.createdAt,
		rotation_seq: input.rotationSeq,
		counts: {
			posts: input.counts.posts,
			assets: input.counts.assets,
			pinned_posts: input.counts.pinned_posts
		},
		files,
		unsigned: true
	};
}

// --- Verification ---

/**
 * Authenticity state of a bundle:
 * - `verified` — v2 signed: every file hash, the rotation chain, the signing key,
 *   and the manifest signature all check out.
 * - `legacy_unsigned` — v1 bundle, or v2 with `unsigned: true`: importable, but
 *   authenticity cannot be established. Surface prominently in the import UI.
 * - `tampered` — a v2 SIGNED bundle that failed a check. Import must hard-fail.
 */
export type BundleTrustState = 'verified' | 'legacy_unsigned' | 'tampered';

export type BundleVerifyCode =
	| 'MANIFEST_INVALID'
	| 'MANIFEST_DID_MISMATCH'
	| 'FILE_MISSING'
	| 'FILE_HASH_MISMATCH'
	| 'EXTRA_FILE'
	| 'CHAIN_INVALID'
	| 'SIGNING_KEY_INVALID'
	| 'SIGNING_KEY_MISMATCH'
	| 'CANONICAL_MISMATCH'
	| 'SIGNATURE_INVALID';

export type BundleTrustResult = {
	state: BundleTrustState;
	/** Present only when `state === 'tampered'`. */
	code?: BundleVerifyCode;
	/** Human-readable reason; present only when `state === 'tampered'`. */
	message?: string;
};

function tampered(code: BundleVerifyCode, message: string): BundleTrustResult {
	return { state: 'tampered', code, message };
}

/** Parse a JSON zip entry, tolerating absence/corruption (returns null). */
function parseJsonEntry(files: Record<string, Uint8Array>, path: string): unknown {
	const bytes = files[path];
	if (!bytes) return null;
	try {
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return null;
	}
}

function extractRotationChain(identity: unknown): RotationStatement[] {
	if (
		identity &&
		typeof identity === 'object' &&
		Array.isArray((identity as Record<string, unknown>).rotationChain)
	) {
		return (identity as { rotationChain: RotationStatement[] }).rotationChain;
	}
	return [];
}

function extractDid(identity: unknown): string | null {
	if (
		identity &&
		typeof identity === 'object' &&
		typeof (identity as Record<string, unknown>).did === 'string'
	) {
		return (identity as { did: string }).did;
	}
	return null;
}

/**
 * Classify a `.syr` bundle as verified / legacy_unsigned / tampered from its raw zip
 * entries alone. Reads manifest.json and identity.json from `files` so the rotation
 * chain and DID are taken from the same bytes whose hashes the signature commits to.
 * Never throws — callers turn `tampered` into their own error.
 */
export async function verifyBundleTrust(
	files: Record<string, Uint8Array>
): Promise<BundleTrustResult> {
	const rawManifest = parseJsonEntry(files, MANIFEST_FILENAME);
	if (!rawManifest || typeof rawManifest !== 'object') {
		// No parseable manifest — not a v2 signed bundle; structural validation lives elsewhere.
		return { state: 'legacy_unsigned' };
	}

	if ((rawManifest as Record<string, unknown>).format_version !== 2) {
		// v1 (or unknown legacy) manifest — authenticity not verifiable.
		return { state: 'legacy_unsigned' };
	}

	const parsed = IdentityExportManifestV2Schema.safeParse(rawManifest);
	if (!parsed.success) {
		return tampered('MANIFEST_INVALID', 'Manifest v2 failed schema validation');
	}
	const manifest = parsed.data;

	if (!manifest.signature) {
		// Explicitly unsigned v2 (self-custody data-only) — not authenticity-verifiable.
		return { state: 'legacy_unsigned' };
	}

	await initCryptoWasm();

	const identity = parseJsonEntry(files, 'identity.json');
	const identityDid = extractDid(identity);
	if (identityDid !== null && identityDid !== manifest.did) {
		return tampered('MANIFEST_DID_MISMATCH', 'Manifest DID does not match identity.json DID');
	}

	// 1. Every hashed file is present and matches.
	for (const [path, expected] of Object.entries(manifest.files)) {
		const bytes = files[path];
		if (!bytes) return tampered('FILE_MISSING', `Bundle is missing hashed file: ${path}`);
		const actual = await computeSha256Hex(toArrayBuffer(bytes));
		if (actual !== expected) {
			return tampered('FILE_HASH_MISMATCH', `Hash mismatch for ${path}`);
		}
	}

	// 2. No file was injected: every entry except manifest.json is covered.
	for (const path of Object.keys(files)) {
		if (path === MANIFEST_FILENAME) continue;
		if (!(path in manifest.files)) {
			return tampered('EXTRA_FILE', `File not covered by signed manifest: ${path}`);
		}
	}

	// 3. Resolve the current root from the embedded chain (genesis when empty).
	let currentRoot: Uint8Array;
	try {
		currentRoot = await verifyRotationChain(manifest.did, extractRotationChain(identity));
	} catch {
		return tampered('CHAIN_INVALID', 'Embedded rotation chain failed verification');
	}

	// 4. The declared signing key must be that resolved current root.
	let signingKeyBytes: Uint8Array;
	try {
		signingKeyBytes = decodePublicKey(manifest.signature.signing_key);
	} catch {
		return tampered('SIGNING_KEY_INVALID', 'Manifest signing key is malformed');
	}
	if (!constantTimeEqual(signingKeyBytes, currentRoot)) {
		return tampered(
			'SIGNING_KEY_MISMATCH',
			'Manifest signing key is not the chain-resolved current root key'
		);
	}

	// 5. The manifest content must match the exact signed payload.
	const recomputed = signableManifestString(manifest);
	if (recomputed !== manifest.signature.signed_payload_json) {
		return tampered('CANONICAL_MISMATCH', 'Manifest content does not match its signed payload');
	}

	// 6. The Ed25519 signature must verify under the current root.
	let sigBytes: Uint8Array;
	try {
		sigBytes = decodeMultibase(manifest.signature.signature);
	} catch {
		return tampered('SIGNATURE_INVALID', 'Manifest signature is malformed');
	}
	const ok = await verify(
		new TextEncoder().encode(manifest.signature.signed_payload_json),
		sigBytes,
		currentRoot
	);
	if (!ok) return tampered('SIGNATURE_INVALID', 'Manifest signature verification failed');

	return { state: 'verified' };
}
