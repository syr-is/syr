import { canonicalize, verify, sign, decodeMultibase, encodeMultibase } from '@syr-is/crypto';
import { parseDid } from '@syr-is/did';
import type { ExportedPost, ExportedAsset } from '@syr-is/types';

/** Post fields for signing (excludes signature and assets — assets are signed separately). */
export function buildPostPayload(
	did: string,
	post: Omit<ExportedPost, 'signature' | 'assets'>
): Record<string, unknown> {
	return {
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
}

/** Asset fields for signing (excludes signature). */
export function buildAssetPayload(
	did: string,
	asset: Omit<ExportedAsset, 'signature'>
): Record<string, unknown> {
	const base: Record<string, unknown> = {
		did,
		local_id: asset.local_id,
		filename: asset.filename,
		mime_type: asset.mime_type,
		size: asset.size,
		zip_path: asset.zip_path
	};
	if (asset.sha256 != null) base.sha256 = asset.sha256;
	return base;
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
		throw new Error('Backup contains unsigned or tampered data');
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
 * Rejects (throws) on invalid or missing signature.
 */
export async function verifyAssetSignature(did: string, asset: ExportedAsset): Promise<void> {
	if (!asset.signature || typeof asset.signature !== 'string') {
		throw new Error('Backup contains unsigned or tampered data');
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
