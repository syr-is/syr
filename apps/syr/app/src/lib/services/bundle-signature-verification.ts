import { canonicalize, verify, sign, decodeMultibase, encodeMultibase } from '@syr-is/crypto';
import { parseDid } from '@syr-is/did';
import { computeSha256Hex } from '@syr-is/utils';
import type { ExportedPost, ExportedAsset } from '@syr-is/types';

/**
 * Post fields for signing (excludes signature; assets included when present to bind post to asset list).
 * Note: Only zip_path and local_id from assets are used — asset signatures are excluded from the payload.
 * Caller may pass ExportedPost (with signature); it is intentionally not included in the payload.
 */
export function buildPostPayload(
	did: string,
	post: Omit<ExportedPost, 'signature'>
): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		did,
		local_id: post.local_id,
		type: post.type,
		...(post.content_type != null && { content_type: post.content_type }),
		...(post.title != null && { title: post.title }),
		...(post.description != null && { description: post.description }),
		...(post.content != null && { content: post.content }),
		...(post.media_urls != null && post.media_urls.length > 0 && { media_urls: post.media_urls }),
		...(post.display_mode != null && { display_mode: post.display_mode }),
		visibility: post.visibility,
		status: post.status,
		created_at: post.created_at
	};
	if (post.assets != null && post.assets.length > 0) {
		payload.assets = post.assets.map((a) => ({ zip_path: a.zip_path, local_id: a.local_id }));
	}
	return payload;
}

/** Asset fields for signing (excludes signature). Requires sha256 for integrity. */
export function buildAssetPayload(
	did: string,
	asset: Omit<ExportedAsset, 'signature'>
): Record<string, unknown> {
	if (asset.sha256 == null || typeof asset.sha256 !== 'string') {
		throw new Error(`Asset ${asset.zip_path} missing sha256 digest — cannot build secure payload`);
	}
	return {
		did,
		local_id: asset.local_id,
		filename: asset.filename,
		mime_type: asset.mime_type,
		size: asset.size,
		zip_path: asset.zip_path,
		sha256: asset.sha256
	};
}

/**
 * Sign a post with the root private key (seed). Returns post with signature.
 */
export async function signPost(
	did: string,
	post: Omit<ExportedPost, 'signature' | 'assets'> & {
		assets?: Omit<ExportedAsset, 'signature'>[];
	},
	privateKey: Uint8Array
): Promise<ExportedPost> {
	const payload = buildPostPayload(did, post);
	const message = canonicalize(payload);
	const sig = await sign(message, privateKey);
	const signature = encodeMultibase(sig);
	const signedAssets = post.assets
		? await Promise.all(post.assets.map((a) => signAsset(did, a, privateKey)))
		: undefined;
	return {
		...post,
		signature,
		assets: signedAssets
	};
}

/**
 * Sign an asset with the root private key. Returns asset with signature.
 */
export async function signAsset(
	did: string,
	asset: Omit<ExportedAsset, 'signature'>,
	privateKey: Uint8Array
): Promise<ExportedAsset> {
	const payload = buildAssetPayload(did, asset);
	const message = canonicalize(payload);
	const sig = await sign(message, privateKey);
	const signature = encodeMultibase(sig);
	return { ...asset, signature };
}

/**
 * Verify a post's signature against the bundle's DID public key.
 * Rejects (throws) on invalid or missing signature.
 */
export async function verifyPostSignature(did: string, post: ExportedPost): Promise<void> {
	if (!post.signature || typeof post.signature !== 'string') {
		throw new Error(
			`Post local_id=${post.local_id} has no signature. If this is a data-only export (keys in Syner), use "Verify with Syner" on the migrate page and provide the import token.`
		);
	}
	const parsedDid = parseDid(did);
	const payload = buildPostPayload(did, post);
	const message = canonicalize(payload);
	const messageBytes = new TextEncoder().encode(message);
	const signatureBytes = decodeMultibase(post.signature);
	const isValid = await verify(messageBytes, signatureBytes, parsedDid.publicKey);
	if (!isValid) {
		throw new Error('Post signature verification failed');
	}
}

/**
 * Verify an asset's signature against the bundle's DID public key.
 * When fileBytes is provided, also validates blob size and SHA-256 against signed values.
 * Rejects (throws) on invalid or missing signature, missing file, size mismatch, or hash mismatch.
 */
export async function verifyAssetSignature(
	did: string,
	asset: ExportedAsset,
	fileBytes: Uint8Array
): Promise<void> {
	if (!asset.signature || typeof asset.signature !== 'string') {
		throw new Error(
			`Asset ${asset.zip_path} has no signature. If this is a data-only export (keys in Syner), use "Verify with Syner" on the migrate page and provide the import token.`
		);
	}
	if (fileBytes == null || fileBytes.byteLength === 0) {
		throw new Error(`Asset ${asset.zip_path} missing from bundle`);
	}
	if (fileBytes.byteLength !== asset.size) {
		throw new Error(
			`Asset ${asset.zip_path} size mismatch: expected ${asset.size}, got ${fileBytes.byteLength}`
		);
	}
	if (asset.sha256 == null || typeof asset.sha256 !== 'string') {
		throw new Error(`Asset ${asset.zip_path} missing sha256 digest — cannot verify integrity`);
	}
	const buf: ArrayBuffer =
		fileBytes.byteOffset === 0 && fileBytes.byteLength === fileBytes.buffer.byteLength
			? (fileBytes.buffer as ArrayBuffer)
			: (fileBytes.buffer.slice(
					fileBytes.byteOffset,
					fileBytes.byteOffset + fileBytes.byteLength
				) as ArrayBuffer);
	const computed = await computeSha256Hex(buf);
	const expected = asset.sha256.toLowerCase();
	if (computed.toLowerCase() !== expected) {
		throw new Error(`Asset ${asset.zip_path} hash mismatch`);
	}
	const parsedDid = parseDid(did);
	const payload = buildAssetPayload(did, asset);
	const message = canonicalize(payload);
	const messageBytes = new TextEncoder().encode(message);
	const signatureBytes = decodeMultibase(asset.signature);
	const isValid = await verify(messageBytes, signatureBytes, parsedDid.publicKey);
	if (!isValid) {
		throw new Error('Asset signature verification failed');
	}
}
