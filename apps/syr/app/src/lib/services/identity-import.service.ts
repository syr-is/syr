import { error } from '@sveltejs/kit';
import { unzip, strFromU8 } from 'fflate';
import { decodePublicKey, constantTimeEqual, canonicalize } from '@syr-is/crypto';
import { parseDid } from '@syr-is/did';
import type { AegisBundle } from '@syr-is/crypto/aegis';
import {
	AnyIdentityExportManifestSchema,
	IdentityExportBundleSchema,
	ExportedPostSchema,
	ExportedAssetSchema,
	stringToRecordId,
	recordIdFromDidAndLocal
} from '@syr-is/types';
import type { ExportedAsset, ExportedPost } from '@syr-is/types';
import {
	verifyPostSignature,
	verifyAssetSignature
} from '$lib/services/bundle-signature-verification';
import { verifyBundleTrust, type BundleTrustState } from '$lib/services/export-manifest';
import { z } from 'zod';
import { identityRepository, delegatedKeyRepository } from '$lib/repositories/identity.repository';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { ensureDefaultIdentityHostUrl } from '$lib/server/ensure-default-identity-host-url.server';
import { postRepository } from '$lib/repositories/post.repository';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { folderRepository } from '$lib/repositories/folder.repository';
import { kvService } from '$lib/services/kv';
import { s3Service } from '$lib/services/s3';
import { s3 as s3Config } from '$lib/config';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { RecordId } from 'surrealdb';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_UNCOMPRESSED_BYTES = MAX_UPLOAD_BYTES * 10; // 1 GB — zip-bomb protection

/** Input/validation errors that should map to 4xx, not 5xx */
export class ImportValidationError extends Error {
	constructor(
		public readonly code: 'IMPORT_INVALID' | 'IMPORT_BAD_SIGNATURE',
		message: string,
		public readonly cause?: unknown
	) {
		super(message);
		this.name = 'ImportValidationError';
		Object.setPrototypeOf(this, ImportValidationError.prototype);
	}
}

/**
 * Schema for assets.json entries. More permissive than ExportedAssetSchema: local_id may be
 * a ULID (post assets) or semantic IDs like "profile-avatar", "profile-banner" (profile assets).
 */
const StandaloneAssetSchema = ExportedAssetSchema.extend({
	local_id: z.string().min(1)
});

/** Only reuse existing upload when both have sha256 and they match; otherwise fall through to re-import. */
function blobMatches(
	existingUpload: { sha256?: string | null } | null,
	asset: { sha256?: string | null }
): boolean {
	if (!existingUpload?.sha256 || !asset?.sha256) return false;
	return existingUpload.sha256 === asset.sha256;
}

/** Returns true if value is a valid URL (ProfileUpdateSchema requires z.url()). Asset paths like assets/... are not valid. */
function isValidProfileUrl(value: string | null | undefined): value is string {
	if (!value || typeof value !== 'string' || value.trim() === '') return false;
	// Reject asset paths — ProfileUpdateSchema requires real URLs
	if (value.startsWith('assets/')) return false;
	try {
		const u = new URL(value);
		return u.protocol === 'http:' || u.protocol === 'https:';
	} catch {
		return false;
	}
}

function zipPathFromUrl(url: string): string | null {
	try {
		const match = new URL(url).pathname.match(/\/uploads\/.+$/);
		if (!match) return null;
		const key = match[0].slice(1);
		return `assets/${key.replace(/^uploads\/[^/]+\//, '')}`;
	} catch {
		return null;
	}
}

async function resolveProfileUrls(
	identity: {
		profile: {
			avatarUrl?: string;
			bannerUrl?: string;
			displayName?: string;
			bio?: string;
			identityHostUrl?: string;
		};
	},
	zipPathToUrl: Record<string, string>,
	resolveAssetUrl?: (path: string) => Promise<string | undefined>
): Promise<{
	avatar_url?: string;
	banner_url?: string;
	display_name?: string;
	bio?: string;
	identity_host_url?: string;
}> {
	const updates: {
		avatar_url?: string;
		banner_url?: string;
		display_name?: string;
		bio?: string;
		identity_host_url?: string;
	} = {
		display_name: identity.profile.displayName,
		bio: identity.profile.bio ?? undefined
	};
	const resolve = async (path: string | undefined): Promise<string | undefined> => {
		if (!path) return undefined;
		if (resolveAssetUrl) {
			return resolveAssetUrl(path);
		}
		const zp = path.startsWith('assets/') ? path : zipPathFromUrl(path);
		if (zp && zipPathToUrl[zp]) return zipPathToUrl[zp];
		return path.startsWith('http://') || path.startsWith('https://') ? path : undefined;
	};
	const avatarResolved = await resolve(identity.profile.avatarUrl ?? undefined);
	const bannerResolved = await resolve(identity.profile.bannerUrl ?? undefined);
	const avatarUrl =
		avatarResolved ??
		(identity.profile.avatarUrl?.startsWith('assets/')
			? undefined
			: (identity.profile.avatarUrl ?? undefined));
	const bannerUrl =
		bannerResolved ??
		(identity.profile.bannerUrl?.startsWith('assets/')
			? undefined
			: (identity.profile.bannerUrl ?? undefined));
	if (avatarUrl != null && isValidProfileUrl(avatarUrl)) updates.avatar_url = avatarUrl;
	if (bannerUrl != null && isValidProfileUrl(bannerUrl)) updates.banner_url = bannerUrl;
	if (isValidProfileUrl(identity.profile.identityHostUrl))
		updates.identity_host_url = identity.profile.identityHostUrl;
	return updates;
}

export type ParsedBundle = {
	files: Record<string, Uint8Array>;
	manifest: z.infer<typeof AnyIdentityExportManifestSchema>;
	identity: z.infer<typeof IdentityExportBundleSchema>;
	posts: z.infer<typeof ExportedPostSchema>[];
};

export type ImportContext = {
	did: string;
	userId: string;
	createdProfile: Awaited<ReturnType<typeof profileRepository.createByUserId>> | null;
	createdPostIds: string[];
	createdUploadIds: string[];
	uploadedS3Keys: string[];
	pinnedPostsRestored: boolean;
};

/**
 * Resolve folder_id from asset zip_path. Creates folder hierarchy if needed.
 * Returns null for root-level files (single segment).
 */
async function resolveFolderIdFromZipPath(
	zipPath: string,
	ownerId: RecordId
): Promise<RecordId | null> {
	const pathWithoutPrefix = zipPath.replace(/^assets\//, '');
	const segments = pathWithoutPrefix.split('/').filter(Boolean);
	if (segments.length <= 1) return null;
	const pathSegments = segments.slice(0, -1);
	const leafFolder = await folderRepository.createHierarchy(ownerId, pathSegments);
	return leafFolder?.id ?? null;
}

/**
 * Unzip and parse the bundle file into manifest, identity, and posts.
 */
export async function parseBundle(file: File): Promise<ParsedBundle> {
	if (typeof file.size !== 'number' || file.size > MAX_UPLOAD_BYTES) {
		throw error(413, {
			code: 'PAYLOAD_TOO_LARGE',
			message: `Bundle size must not exceed ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`
		});
	}

	const arrayBuffer = await file.arrayBuffer();
	const zipBytes = new Uint8Array(arrayBuffer);

	let files: Record<string, Uint8Array>;
	try {
		let totalUncompressed = 0;
		files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
			unzip(
				zipBytes,
				{
					filter(entry) {
						if ((entry.originalSize === 0 || entry.originalSize == null) && entry.size > 0) {
							reject(
								new Error(
									'Suspicious zip entry: compressed size present but uncompressed size missing'
								)
							);
							return false;
						}
						const size = entry.originalSize ?? 0;
						if (totalUncompressed + size > MAX_UNCOMPRESSED_BYTES) {
							reject(new Error('Uncompressed size exceeds limit'));
							return false;
						}
						totalUncompressed += size;
						return true;
					}
				},
				(err, data) => {
					if (err) reject(err);
					else resolve(data);
				}
			);
		});
	} catch {
		throw error(400, { code: 'INVALID_ZIP', message: 'Could not parse zip file' });
	}

	if (!files['manifest.json'] || !files['identity.json'] || !files['posts.json']) {
		throw error(400, {
			code: 'INVALID_BUNDLE',
			message: 'Zip must contain manifest.json, identity.json, and posts.json'
		});
	}

	let manifest: z.infer<typeof AnyIdentityExportManifestSchema>;
	let identity: z.infer<typeof IdentityExportBundleSchema>;
	let posts: z.infer<typeof ExportedPostSchema>[];
	try {
		manifest = AnyIdentityExportManifestSchema.parse(JSON.parse(strFromU8(files['manifest.json'])));
		identity = IdentityExportBundleSchema.parse(JSON.parse(strFromU8(files['identity.json'])));
		posts = z.array(ExportedPostSchema).parse(JSON.parse(strFromU8(files['posts.json'])));
	} catch (err) {
		const msg =
			err instanceof z.ZodError
				? (err.issues?.[0]?.message ?? err.message)
				: err instanceof SyntaxError
					? `Invalid JSON: ${err.message}`
					: err instanceof Error
						? err.message
						: 'Invalid or malformed bundle data';
		throw error(400, { code: 'INVALID_IMPORT', message: msg });
	}

	return { files, manifest, identity, posts };
}

/**
 * Server-side authenticity backstop. Re-verifies the manifest v2 signature, rotation
 * chain, and every file hash directly from the zip bytes (never trusting the client's
 * own verification). Hard-fails a tampered v2 SIGNED bundle with HTTP 422 and a precise
 * sub-code. v1 bundles and explicitly-unsigned v2 bundles pass through as legacy state.
 * Must run before any DB/S3 writes.
 */
export async function assertBundleIntegrity(parsed: ParsedBundle): Promise<BundleTrustState> {
	const result = await verifyBundleTrust(parsed.files);
	if (result.state === 'tampered') {
		throw error(422, {
			code: 'IMPORT_TAMPERED',
			message: `[${result.code ?? 'MANIFEST_INVALID'}] ${result.message ?? 'Bundle failed integrity verification'}`
		});
	}
	return result.state;
}

export type ValidateBundleOpts = { allowExistingDid?: boolean };

/**
 * Validate bundle: DID match, public key match, Aegis bundle match.
 * When allowExistingDid is true, skips the DID_EXISTS check (for sync of own backup).
 */
export async function validateBundle(
	parsed: ParsedBundle,
	aegisBundle: AegisBundle,
	opts: ValidateBundleOpts = {}
): Promise<string> {
	const { manifest, identity } = parsed;

	if (manifest.did !== identity.did) {
		throw error(400, {
			code: 'DID_MISMATCH',
			message: 'Manifest DID does not match identity DID'
		});
	}

	if (aegisBundle.pub !== identity.publicKey) {
		throw error(400, {
			code: 'KEY_MISMATCH',
			message: 'Aegis bundle public key does not match identity public key'
		});
	}

	try {
		const parsedDid = parseDid(identity.did);
		const pubKeyFromDid = parsedDid.publicKey;
		const pubKeyFromBundle = decodePublicKey(identity.publicKey);

		// This asserts the bundle's key equals the DID-derived GENESIS key. A
		// rotated identity's bundle carries the CURRENT root as identity.publicKey,
		// so it fails here. This is a CREATION-time gate, not an authenticity gate:
		// the bundle now carries its full rotation chain (identity.json rotationChain)
		// and assertBundleIntegrity/verifyBundleTrust already verify a rotated bundle's
		// manifest signature under the chain-resolved current root. Re-homing a rotated
		// identity onto a foreign instance stays out of scope for v1 solely because
		// creation requires genesis == identity.publicKey. See
		// architecture/recovery-rotation §10.1. On the identity's home instance the
		// rotation chain lives in identity_rotation and everything resolves normally.
		if (!constantTimeEqual(pubKeyFromDid, pubKeyFromBundle)) {
			throw error(400, {
				code: 'KEY_MISMATCH',
				message: 'Public key in bundle does not match the DID'
			});
		}
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		throw error(400, {
			code: 'IMPORT_FAILED',
			message: 'Failed to validate DID/public key'
		});
	}

	if (!opts.allowExistingDid) {
		const existingDid = await identityRepository.findByDid(identity.did);
		if (existingDid) {
			throw error(409, {
				code: 'DID_EXISTS',
				message: 'An identity with this DID already exists on this instance'
			});
		}
	}

	return identity.did;
}

/**
 * Validate bundle for data-only import (no Sigil/Aegis). Checks manifest/identity match.
 * When allowExistingDid is true, skips the DID_EXISTS check (for sync of own backup).
 */
export async function validateBundleForDataOnlyImport(
	parsed: ParsedBundle,
	opts: ValidateBundleOpts = {}
): Promise<string> {
	const { manifest, identity } = parsed;

	if (manifest.did !== identity.did) {
		throw error(400, {
			code: 'DID_MISMATCH',
			message: 'Manifest DID does not match identity DID'
		});
	}

	try {
		const parsedDid = parseDid(identity.did);
		const pubKeyFromDid = parsedDid.publicKey;
		const pubKeyFromBundle = decodePublicKey(identity.publicKey);

		if (!constantTimeEqual(pubKeyFromDid, pubKeyFromBundle)) {
			throw error(400, {
				code: 'KEY_MISMATCH',
				message: 'Public key in bundle does not match the DID'
			});
		}
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		throw error(400, {
			code: 'IMPORT_FAILED',
			message: 'Failed to validate DID/public key'
		});
	}

	if (!opts.allowExistingDid) {
		const existingDid = await identityRepository.findByDid(identity.did);
		if (existingDid) {
			throw error(409, {
				code: 'DID_EXISTS',
				message: 'An identity with this DID already exists on this instance'
			});
		}
	}

	return identity.did;
}

/**
 * Create identity (external, no Aegis), profile, and delegated keys. Mutates ctx.
 */
export async function importIdentityAndProfileExternal(
	ctx: ImportContext,
	parsed: ParsedBundle
): Promise<void> {
	const { identity } = parsed;

	await identityRepository.createIdentityExternal({
		did: ctx.did,
		publicKey: identity.publicKey,
		userId: stringToRecordId.decode(ctx.userId),
		now: new Date()
	});

	await userRepository.updateDid(stringToRecordId.decode(ctx.userId), ctx.did);

	ctx.createdProfile = await profileRepository.createByUserId(ctx.userId);
	const profileUpdates: {
		display_name?: string;
		bio?: string;
		avatar_url?: string;
		banner_url?: string;
		identity_host_url?: string;
	} = {
		display_name: identity.profile.displayName,
		bio: identity.profile.bio ?? undefined
	};
	if (isValidProfileUrl(identity.profile.avatarUrl))
		profileUpdates.avatar_url = identity.profile.avatarUrl;
	if (isValidProfileUrl(identity.profile.bannerUrl))
		profileUpdates.banner_url = identity.profile.bannerUrl;
	if (isValidProfileUrl(identity.profile.identityHostUrl))
		profileUpdates.identity_host_url = identity.profile.identityHostUrl;
	await profileRepository.mergeByUserId(ctx.userId, profileUpdates);
	await ensureDefaultIdentityHostUrl(ctx.userId, ctx.did);

	for (const dk of identity.delegatedKeys) {
		const canonicalDelegation = canonicalize({
			did: ctx.did,
			delegate: dk.publicKey,
			scope: dk.scope,
			createdAt: dk.createdAt,
			...(dk.expiresAt ? { expiresAt: dk.expiresAt } : {})
		});
		const created = await delegatedKeyRepository.createDelegatedKey({
			did: ctx.did,
			publicKey: dk.publicKey,
			scope: dk.scope,
			createdAt: new Date(dk.createdAt),
			expiresAt: dk.expiresAt ? new Date(dk.expiresAt) : undefined,
			signature: dk.signature,
			canonicalDelegation
		});
		if (dk.revokedAt) {
			await delegatedKeyRepository.revoke(created.id);
		}
	}
}

/**
 * Create identity, profile, and delegated keys. Mutates ctx.
 */
export async function importIdentityAndProfile(
	ctx: ImportContext,
	parsed: ParsedBundle,
	aegisBundle: AegisBundle
): Promise<void> {
	const { identity } = parsed;

	// Defense-in-depth: validateBundle already enforces this invariant; recheck before DB writes.
	if (aegisBundle.pub !== identity.publicKey) {
		throw error(400, {
			code: 'KEY_MISMATCH',
			message: 'Aegis bundle public key does not match identity public key'
		});
	}

	await identityRepository.create({
		did: ctx.did,
		public_key: identity.publicKey,
		user_id: stringToRecordId.decode(ctx.userId),
		created_at: new Date(),
		aegis_salt: aegisBundle.salt,
		aegis_nonce: aegisBundle.nonce,
		aegis_ct: aegisBundle.ct,
		aegis_tag: aegisBundle.tag,
		aegis_kdf_mem: aegisBundle.kdf.mem,
		aegis_kdf_it: aegisBundle.kdf.it,
		aegis_kdf_par: aegisBundle.kdf.par
	});

	await userRepository.updateDid(stringToRecordId.decode(ctx.userId), ctx.did);

	ctx.createdProfile = await profileRepository.createByUserId(ctx.userId);
	const aegisProfileUpdates: {
		display_name?: string;
		bio?: string;
		avatar_url?: string;
		banner_url?: string;
		identity_host_url?: string;
	} = {
		display_name: identity.profile.displayName,
		bio: identity.profile.bio ?? undefined
	};
	if (isValidProfileUrl(identity.profile.avatarUrl))
		aegisProfileUpdates.avatar_url = identity.profile.avatarUrl;
	if (isValidProfileUrl(identity.profile.bannerUrl))
		aegisProfileUpdates.banner_url = identity.profile.bannerUrl;
	if (isValidProfileUrl(identity.profile.identityHostUrl))
		aegisProfileUpdates.identity_host_url = identity.profile.identityHostUrl;
	await profileRepository.mergeByUserId(ctx.userId, aegisProfileUpdates);
	await ensureDefaultIdentityHostUrl(ctx.userId, ctx.did);

	for (const dk of identity.delegatedKeys) {
		const canonicalDelegation = canonicalize({
			did: ctx.did,
			delegate: dk.publicKey,
			scope: dk.scope,
			createdAt: dk.createdAt,
			...(dk.expiresAt ? { expiresAt: dk.expiresAt } : {})
		});
		const created = await delegatedKeyRepository.createDelegatedKey({
			did: ctx.did,
			publicKey: dk.publicKey,
			scope: dk.scope,
			createdAt: new Date(dk.createdAt),
			expiresAt: dk.expiresAt ? new Date(dk.expiresAt) : undefined,
			signature: dk.signature,
			canonicalDelegation
		});
		if (dk.revokedAt) {
			await delegatedKeyRepository.revoke(created.id);
		}
	}
}

export type ImportSigningOpts = {
	/** When true, verify post and asset signatures. When false (data-only), skip. */
	verifySignatures: boolean;
};

type ImportAssetOpts = {
	verifySignatures: boolean;
	/** When set, skip S3+DB if existing upload has matching sha256. Return existing url. */
	skipIfExists?: boolean;
	/** When set and skipIfExists, caller pre-fetched existing. If blob differs, update instead of create. */
	existingUpload?: { id: string; url: string; sha256?: string | null } | null;
	logLabel?: string;
};

async function importSingleAsset(
	ctx: ImportContext,
	asset: ExportedAsset,
	assetData: Uint8Array,
	opts: ImportAssetOpts
): Promise<{ url: string; zipPath: string }> {
	const logLabel = opts.logLabel ?? 'importSingleAsset';
	if (opts.verifySignatures) {
		try {
			await verifyAssetSignature(ctx.did, asset, assetData);
		} catch (e) {
			throw new ImportValidationError(
				'IMPORT_BAD_SIGNATURE',
				e instanceof Error ? e.message : 'Asset signature verification failed',
				e
			);
		}
	}
	if (opts.skipIfExists && opts.existingUpload && blobMatches(opts.existingUpload, asset)) {
		return { url: opts.existingUpload.url, zipPath: asset.zip_path };
	}
	const s3Key = `uploads/${ctx.did}/${asset.zip_path.replace(/^assets\//, '')}`;
	try {
		await s3Service.client.send(
			new PutObjectCommand({
				Bucket: s3Config.bucket,
				Key: s3Key,
				Body: assetData,
				ContentType: asset.mime_type
			})
		);
		const url = `${s3Config.endpoint}/${s3Config.bucket}/${s3Key}`;
		const folderId = await resolveFolderIdFromZipPath(
			asset.zip_path,
			stringToRecordId.decode(ctx.userId)
		);
		const isPublic = folderId ? await folderRepository.isInPublicHierarchy(folderId) : false;
		const uploadData = {
			key: s3Key,
			owner_id: stringToRecordId.decode(ctx.userId),
			folder_id: folderId,
			filename: asset.filename,
			mime_type: asset.mime_type,
			size: asset.size,
			sha256: asset.sha256,
			url,
			status: 'completed' as const,
			is_public: isPublic,
			created_at: new Date(),
			updated_at: new Date()
		};
		if (opts.existingUpload && !blobMatches(opts.existingUpload, asset)) {
			await uploadRepository.update(opts.existingUpload.id, {
				key: s3Key,
				owner_id: uploadData.owner_id,
				folder_id: uploadData.folder_id,
				filename: uploadData.filename,
				mime_type: uploadData.mime_type,
				size: uploadData.size,
				sha256: uploadData.sha256,
				url: uploadData.url,
				status: uploadData.status,
				is_public: uploadData.is_public,
				updated_at: new Date()
			});
		} else {
			const createdUpload = await uploadRepository.createWithExplicitId(
				ctx.did,
				asset.local_id,
				uploadData
			);
			ctx.createdUploadIds.push(createdUpload.id.toString());
		}
		ctx.uploadedS3Keys.push(s3Key);
		return { url, zipPath: asset.zip_path };
	} catch (err) {
		try {
			await s3Service.client.send(new DeleteObjectCommand({ Bucket: s3Config.bucket, Key: s3Key }));
		} catch {
			// Best-effort S3 cleanup
		}
		console.error(`[${logLabel}] Asset upload failed`, {
			zip_path: asset.zip_path,
			local_id: asset.local_id,
			s3Key,
			error: err instanceof Error ? err.message : String(err)
		});
		throw err;
	}
}

type ImportPostOpts = {
	verifySignatures: boolean;
	/** When true, skip this post if it already exists. */
	skipIfExists?: boolean;
	/** For each post.asset: when true, pass existingUpload to importSingleAsset. */
	skipAssetsIfExists?: boolean;
	logLabel?: string;
};

async function importSinglePost(
	ctx: ImportContext,
	post: ExportedPost,
	files: Record<string, Uint8Array>,
	importedZipPaths: Set<string>,
	zipPathToUrl: Record<string, string>,
	opts: ImportPostOpts
): Promise<{ imported: boolean; assetsImported: number } | null> {
	const logLabel = opts.logLabel ?? 'importSinglePost';
	if (opts.verifySignatures) {
		try {
			await verifyPostSignature(ctx.did, post);
		} catch (e) {
			throw new ImportValidationError(
				'IMPORT_BAD_SIGNATURE',
				e instanceof Error ? e.message : 'Post signature verification failed',
				e
			);
		}
	}
	if (opts.skipIfExists) {
		const existingPost = await postRepository.findById(
			recordIdFromDidAndLocal('post', ctx.did, post.local_id)
		);
		if (existingPost) return null;
	}
	const mediaUrls: string[] = [];
	let assetsImported = 0;
	if (post.assets) {
		for (const asset of post.assets) {
			const assetData = files[asset.zip_path];
			if (!assetData)
				throw new ImportValidationError(
					'IMPORT_INVALID',
					`Asset ${asset.zip_path} missing from bundle`
				);
			let existingUpload: { id: string; url: string; sha256?: string | null } | null = null;
			if (opts.skipAssetsIfExists) {
				const existing = await uploadRepository.findByCompositeId(ctx.did, asset.local_id);
				if (existing) {
					existingUpload = {
						id: existing.id.toString(),
						url: existing.url ?? '',
						sha256: existing.sha256
					};
				}
			}
			const result = await importSingleAsset(ctx, asset, assetData, {
				verifySignatures: opts.verifySignatures,
				skipIfExists: opts.skipAssetsIfExists,
				existingUpload: existingUpload ?? undefined,
				logLabel
			});
			mediaUrls.push(result.url);
			zipPathToUrl[result.zipPath] = result.url;
			importedZipPaths.add(result.zipPath);
			const skipped =
				opts.skipAssetsIfExists && existingUpload && blobMatches(existingUpload, asset);
			if (!skipped) assetsImported++;
		}
	}
	try {
		const createdPost = await postRepository.createWithExplicitId(ctx.did, post.local_id, {
			type: post.type,
			content_type: post.content_type,
			title: post.title,
			description: post.description,
			content: post.content,
			media_urls: mediaUrls.length > 0 ? mediaUrls : (post.media_urls ?? undefined),
			display_mode: post.display_mode,
			visibility: post.visibility,
			status: post.status,
			author_id: stringToRecordId.decode(ctx.userId),
			created_at: new Date(post.created_at),
			updated_at: new Date()
		});
		ctx.createdPostIds.push(createdPost.id.toString());
		return { imported: true, assetsImported };
	} catch (err) {
		console.error(`[${logLabel}] Post create failed`, {
			local_id: post.local_id,
			error: err instanceof Error ? err.message : String(err)
		});
		throw err;
	}
}

/**
 * Import posts and their assets. Mutates ctx. Returns import stats and zip paths for standalone asset dedup.
 */
export async function importPostsAndAssets(
	ctx: ImportContext,
	parsed: ParsedBundle,
	opts: ImportSigningOpts = { verifySignatures: true }
): Promise<{ postsImported: number; assetsImported: number; importedZipPaths: Set<string> }> {
	const { files, posts } = parsed;
	const importedZipPaths = new Set<string>();
	const zipPathToUrl: Record<string, string> = {};
	let postsImported = 0;
	let assetsImported = 0;

	for (const post of posts) {
		const result = await importSinglePost(ctx, post, files, importedZipPaths, zipPathToUrl, {
			verifySignatures: opts.verifySignatures,
			skipIfExists: false,
			logLabel: 'importPostsAndAssets'
		});
		if (result) {
			postsImported++;
			assetsImported += result.assetsImported;
		}
	}

	return { postsImported, assetsImported, importedZipPaths };
}

/**
 * Import standalone assets from assets.json (not referenced in any post). Mutates ctx.
 */
export async function importStandaloneAssets(
	ctx: ImportContext,
	parsed: ParsedBundle,
	importedZipPaths: Set<string>,
	opts: ImportSigningOpts = { verifySignatures: true }
): Promise<number> {
	const { files } = parsed;
	const assetsPayload = files['assets.json'];
	if (!assetsPayload) return 0;

	try {
		const parsedAssets = z
			.object({
				assets: z.array(StandaloneAssetSchema)
			})
			.parse(JSON.parse(strFromU8(assetsPayload)));

		const zipPathToUrl: Record<string, string> = {};
		let assetsImported = 0;
		for (const asset of parsedAssets.assets) {
			if (importedZipPaths.has(asset.zip_path)) continue;
			const assetData = files[asset.zip_path];
			if (!assetData)
				throw new ImportValidationError(
					'IMPORT_INVALID',
					`Asset ${asset.zip_path} missing from bundle`
				);
			const result = await importSingleAsset(ctx, asset, assetData, {
				verifySignatures: opts.verifySignatures,
				logLabel: 'importStandaloneAssets'
			});
			if (result) {
				zipPathToUrl[result.zipPath] = result.url;
				assetsImported++;
				importedZipPaths.add(result.zipPath);
			}
		}
		for (const asset of parsedAssets.assets) {
			if (importedZipPaths.has(asset.zip_path) && !zipPathToUrl[asset.zip_path]) {
				const s3Key = `uploads/${ctx.did}/${asset.zip_path.replace(/^assets\//, '')}`;
				zipPathToUrl[asset.zip_path] = `${s3Config.endpoint}/${s3Config.bucket}/${s3Key}`;
			}
		}
		const updates = await resolveProfileUrls(parsed.identity, zipPathToUrl);
		const profileUpdates = {
			...(updates.avatar_url && { avatar_url: updates.avatar_url }),
			...(updates.banner_url && { banner_url: updates.banner_url })
		};
		if (Object.keys(profileUpdates).length > 0) {
			await profileRepository.mergeByUserId(ctx.userId, profileUpdates);
		}
		return assetsImported;
	} catch (err) {
		if (err instanceof ImportValidationError) throw err;
		console.error('[importStandaloneAssets] Failed to parse or import assets', {
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined
		});
		throw err;
	}
}

/**
 * Restore pinned posts from bundle if present. Mutates ctx.
 */
export async function restorePinnedPosts(
	ctx: ImportContext,
	parsed: ParsedBundle
): Promise<number> {
	const { files, posts } = parsed;
	const pinnedPayload = files['pinned_posts.json'];
	if (!pinnedPayload) return 0;

	try {
		const parsedPinned = z
			.object({ post_ids: z.array(z.string()) })
			.parse(JSON.parse(strFromU8(pinnedPayload)));

		if (parsedPinned.post_ids.length === 0) return 0;

		const importedIds = new Set(posts.map((p) => `${ctx.did}/${p.local_id}`));
		const validPinned = parsedPinned.post_ids.filter((id) => importedIds.has(id));

		if (validPinned.length > 0) {
			await kvService.set('pinned_posts', String(ctx.userId), { post_ids: validPinned });
			ctx.pinnedPostsRestored = true;
			return validPinned.length;
		}
	} catch {
		// Ignore malformed pinned_posts.json
	}
	return 0;
}

/**
 * Sync posts and profile from bundle into existing identity.
 * Skips posts/uploads that already exist (by composite ID).
 * Does not create identity - assumes it already exists.
 */
export async function syncPostsAndProfileFromBundle(
	ctx: ImportContext,
	parsed: ParsedBundle,
	opts: ImportSigningOpts = { verifySignatures: true }
): Promise<{ postsImported: number; assetsImported: number; profileUpdated: boolean }> {
	const { identity, files, posts } = parsed;

	const zipPathToUrl: Record<string, string> = {};
	const importedZipPaths = new Set<string>();
	let postsImported = 0;
	let assetsImported = 0;

	for (const post of posts) {
		const result = await importSinglePost(ctx, post, files, importedZipPaths, zipPathToUrl, {
			verifySignatures: opts.verifySignatures,
			skipIfExists: true,
			skipAssetsIfExists: true,
			logLabel: 'syncPostsAndProfileFromBundle'
		});
		if (result) {
			postsImported++;
			assetsImported += result.assetsImported;
		}
	}

	const assetsPayload = files['assets.json'];
	if (assetsPayload) {
		try {
			const parsedAssets = z
				.object({ assets: z.array(StandaloneAssetSchema) })
				.parse(JSON.parse(strFromU8(assetsPayload)));
			for (const asset of parsedAssets.assets) {
				if (importedZipPaths.has(asset.zip_path)) continue;
				const assetData = files[asset.zip_path];
				if (!assetData)
					throw new ImportValidationError(
						'IMPORT_INVALID',
						`Asset ${asset.zip_path} missing from bundle`
					);
				const existing = await uploadRepository.findByCompositeId(ctx.did, asset.local_id);
				const existingUpload = existing
					? { id: existing.id.toString(), url: existing.url ?? '', sha256: existing.sha256 }
					: null;
				const result = await importSingleAsset(ctx, asset, assetData, {
					verifySignatures: opts.verifySignatures,
					skipIfExists: true,
					existingUpload: existingUpload ?? undefined,
					logLabel: 'syncPostsAndProfileFromBundle'
				});
				if (result) {
					zipPathToUrl[result.zipPath] = result.url;
					importedZipPaths.add(result.zipPath);
					const skipped = existingUpload && blobMatches(existingUpload, asset);
					if (!skipped) assetsImported++;
				}
			}
		} catch (err) {
			if (err instanceof ImportValidationError) throw err;
			console.error('[syncPostsAndProfileFromBundle] assets.json parse/import failed', err);
			throw err;
		}
	}

	function keyFromUrl(url: string): string | null {
		try {
			const match = new URL(url).pathname.match(/\/uploads\/.+$/);
			return match ? match[0].slice(1) : null;
		} catch {
			return null;
		}
	}
	function keyToZipPath(key: string): string {
		return `assets/${key.replace(/^uploads\/[^/]+\//, '')}`;
	}
	const resolveAssetUrl = async (path: string | undefined): Promise<string | undefined> => {
		if (!path) return undefined;
		if (zipPathToUrl[path] != null) return zipPathToUrl[path];
		if (path.startsWith('http://') || path.startsWith('https://')) {
			const key = keyFromUrl(path);
			if (key) {
				const zp = keyToZipPath(key);
				if (zipPathToUrl[zp] != null) return zipPathToUrl[zp];
			}
			return path;
		}
		const allAssets = [
			...posts.flatMap((p) => p.assets ?? []),
			...(files['assets.json']
				? (() => {
						try {
							const parsedAssetsJson = z
								.object({ assets: z.array(StandaloneAssetSchema) })
								.parse(JSON.parse(strFromU8(files['assets.json'])));
							return parsedAssetsJson.assets;
						} catch {
							return [];
						}
					})()
				: [])
		];
		const asset = allAssets.find((a) => a.zip_path === path);
		if (asset) {
			const existing = await uploadRepository.findByCompositeId(ctx.did, asset.local_id);
			if (existing?.url && blobMatches(existing, asset)) {
				zipPathToUrl[path] = existing.url;
				return existing.url;
			}
		}
		return undefined;
	};

	const profileUpdates = await resolveProfileUrls(identity, zipPathToUrl, resolveAssetUrl);
	await profileRepository.mergeByUserId(ctx.userId, profileUpdates);

	return { postsImported, assetsImported, profileUpdated: true };
}

/**
 * Rollback partial import: remove DB records and S3 objects in reverse order.
 */
export async function rollbackImport(ctx: ImportContext): Promise<void> {
	if (ctx.pinnedPostsRestored) {
		try {
			await kvService.delete('pinned_posts', String(ctx.userId));
		} catch (e) {
			console.error('Rollback: failed to delete pinned_posts', e);
		}
	}
	// Delete posts before uploads to avoid posts with dangling media_urls
	for (const postId of ctx.createdPostIds) {
		try {
			await postRepository.delete(postId);
		} catch {
			// Best-effort per-record cleanup
		}
	}
	for (const uploadId of ctx.createdUploadIds) {
		try {
			await uploadRepository.delete(uploadId);
		} catch {
			// Best-effort per-record cleanup
		}
	}
	try {
		await delegatedKeyRepository.deleteByDid(ctx.did);
	} catch (e) {
		console.error('Rollback: failed to delete delegated keys', e);
	}
	if (ctx.createdProfile) {
		try {
			await profileRepository.delete(ctx.createdProfile.id);
		} catch {
			// Best-effort
		}
	}
	try {
		await userRepository.unsetDid(stringToRecordId.decode(ctx.userId));
	} catch (e) {
		console.error('Rollback: failed to unset user.did', e);
	}
	try {
		await identityRepository.deleteByDid(ctx.did);
	} catch (e) {
		console.error('Rollback: failed to delete identity', e);
	}
	for (const key of ctx.uploadedS3Keys) {
		try {
			await s3Service.client.send(new DeleteObjectCommand({ Bucket: s3Config.bucket, Key: key }));
		} catch {
			// Best-effort
		}
	}
}
