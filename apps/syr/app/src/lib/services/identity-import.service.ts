import { error } from '@sveltejs/kit';
import { unzip, strFromU8 } from 'fflate';
import { decodePublicKey, constantTimeEqual, canonicalize } from '@syr-is/crypto';
import { parseDid } from '@syr-is/did';
import type { AegisBundle } from '@syr-is/crypto/aegis';
import {
	IdentityExportManifestSchema,
	IdentityExportBundleSchema,
	ExportedPostSchema,
	ExportedAssetSchema,
	stringToRecordId,
	recordIdFromDidAndLocal
} from '@syr-is/types';
import {
	verifyPostSignature,
	verifyAssetSignature
} from '$lib/services/bundle-signature-verification';
import { z } from 'zod';
import { identityRepository, delegatedKeyRepository } from '$lib/repositories/identity.repository';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
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

export type ParsedBundle = {
	files: Record<string, Uint8Array>;
	manifest: z.infer<typeof IdentityExportManifestSchema>;
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

	let manifest: z.infer<typeof IdentityExportManifestSchema>;
	let identity: z.infer<typeof IdentityExportBundleSchema>;
	let posts: z.infer<typeof ExportedPostSchema>[];
	try {
		manifest = IdentityExportManifestSchema.parse(JSON.parse(strFromU8(files['manifest.json'])));
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
	} = {
		display_name: identity.profile.displayName,
		bio: identity.profile.bio ?? undefined
	};
	if (isValidProfileUrl(identity.profile.avatarUrl))
		profileUpdates.avatar_url = identity.profile.avatarUrl;
	if (isValidProfileUrl(identity.profile.bannerUrl))
		profileUpdates.banner_url = identity.profile.bannerUrl;
	await profileRepository.mergeByUserId(ctx.userId, profileUpdates);

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
	} = {
		display_name: identity.profile.displayName,
		bio: identity.profile.bio ?? undefined
	};
	if (isValidProfileUrl(identity.profile.avatarUrl))
		aegisProfileUpdates.avatar_url = identity.profile.avatarUrl;
	if (isValidProfileUrl(identity.profile.bannerUrl))
		aegisProfileUpdates.banner_url = identity.profile.bannerUrl;
	await profileRepository.mergeByUserId(ctx.userId, aegisProfileUpdates);

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
	let postsImported = 0;
	let assetsImported = 0;

	for (let i = 0; i < posts.length; i++) {
		const post = posts[i];
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

		const mediaUrls: string[] = [];
		if (post.assets) {
			for (const asset of post.assets) {
				const assetData = files[asset.zip_path];
				if (!assetData)
					throw new ImportValidationError(
						'IMPORT_INVALID',
						`Asset ${asset.zip_path} missing from bundle`
					);
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

					const createdUpload = await uploadRepository.createWithExplicitId(
						ctx.did,
						asset.local_id,
						{
							key: s3Key,
							owner_id: stringToRecordId.decode(ctx.userId),
							folder_id: folderId,
							filename: asset.filename,
							mime_type: asset.mime_type,
							size: asset.size,
							sha256: asset.sha256,
							url,
							status: 'completed',
							is_public: isPublic,
							created_at: new Date(),
							updated_at: new Date()
						}
					);
					ctx.uploadedS3Keys.push(s3Key);
					ctx.createdUploadIds.push(createdUpload.id.toString());
					mediaUrls.push(url);
					assetsImported++;
					importedZipPaths.add(asset.zip_path);
				} catch (err) {
					try {
						await s3Service.client.send(
							new DeleteObjectCommand({ Bucket: s3Config.bucket, Key: s3Key })
						);
					} catch {
						// Best-effort S3 cleanup
					}
					console.error('[importPostsAndAssets] Asset upload failed', {
						zip_path: asset.zip_path,
						local_id: asset.local_id,
						s3Key,
						error: err instanceof Error ? err.message : String(err)
					});
					throw err;
				}
			}
		}

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

		postsImported++;
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

		let assetsImported = 0;
		for (const asset of parsedAssets.assets) {
			if (importedZipPaths.has(asset.zip_path)) continue;
			const assetData = files[asset.zip_path];
			if (!assetData)
				throw new ImportValidationError(
					'IMPORT_INVALID',
					`Asset ${asset.zip_path} missing from bundle`
				);
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
				ctx.uploadedS3Keys.push(s3Key);
				const url = `${s3Config.endpoint}/${s3Config.bucket}/${s3Key}`;
				const folderId = await resolveFolderIdFromZipPath(
					asset.zip_path,
					stringToRecordId.decode(ctx.userId)
				);
				const isPublic = folderId ? await folderRepository.isInPublicHierarchy(folderId) : false;
				const createdUpload = await uploadRepository.createWithExplicitId(ctx.did, asset.local_id, {
					key: s3Key,
					owner_id: stringToRecordId.decode(ctx.userId),
					folder_id: folderId,
					filename: asset.filename,
					mime_type: asset.mime_type,
					size: asset.size,
					sha256: asset.sha256,
					url,
					status: 'completed',
					is_public: isPublic,
					created_at: new Date(),
					updated_at: new Date()
				});
				ctx.createdUploadIds.push(createdUpload.id.toString());
				assetsImported++;
				importedZipPaths.add(asset.zip_path);
			} catch (err) {
				console.error('[importStandaloneAssets] Asset upload/DB failed', {
					zip_path: asset.zip_path,
					local_id: asset.local_id,
					s3Key,
					url: `${s3Config.endpoint}/${s3Config.bucket}/${s3Key}`,
					error: err instanceof Error ? err.message : String(err),
					stack: err instanceof Error ? err.stack : undefined
				});
				throw err;
			}
		}
		// If profile avatar/banner are asset paths or full URLs, resolve to S3 URLs
		const updates: { avatar_url?: string; banner_url?: string } = {};
		const zipPathToUrl = new Map<string, string>();
		for (const asset of parsedAssets.assets) {
			if (!importedZipPaths.has(asset.zip_path)) continue;
			const s3Key = `uploads/${ctx.did}/${asset.zip_path.replace(/^assets\//, '')}`;
			const url = `${s3Config.endpoint}/${s3Config.bucket}/${s3Key}`;
			zipPathToUrl.set(asset.zip_path, url);
			if (parsed.identity.profile.avatarUrl === asset.zip_path) updates.avatar_url = url;
			if (parsed.identity.profile.bannerUrl === asset.zip_path) updates.banner_url = url;
		}
		// Handle full S3 URLs (e.g. from older exports before zip_path transform)
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
		for (const [urlOrPath, field] of [
			[parsed.identity.profile.avatarUrl, 'avatar_url'] as const,
			[parsed.identity.profile.bannerUrl, 'banner_url'] as const
		]) {
			if (!urlOrPath || updates[field]) continue;
			const zp = urlOrPath.startsWith('assets/') ? urlOrPath : zipPathFromUrl(urlOrPath);
			if (zp && zipPathToUrl.has(zp)) updates[field] = zipPathToUrl.get(zp)!;
		}
		if (Object.keys(updates).length > 0) {
			await profileRepository.mergeByUserId(ctx.userId, updates);
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
		const existingPost = await postRepository.findById(
			recordIdFromDidAndLocal('post', ctx.did, post.local_id)
		);
		if (existingPost) continue;

		const mediaUrls: string[] = [];
		if (post.assets) {
			for (const asset of post.assets) {
				const assetData = files[asset.zip_path];
				if (!assetData)
					throw new ImportValidationError(
						'IMPORT_INVALID',
						`Asset ${asset.zip_path} missing from bundle`
					);
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

				const existingUpload = await uploadRepository.findByCompositeId(ctx.did, asset.local_id);
				if (existingUpload?.url && blobMatches(existingUpload, asset)) {
					zipPathToUrl[asset.zip_path] = existingUpload.url;
					mediaUrls.push(existingUpload.url);
					continue;
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
					if (existingUpload && !blobMatches(existingUpload, asset)) {
						await uploadRepository.update(existingUpload.id, {
							key: s3Key,
							owner_id: stringToRecordId.decode(ctx.userId),
							folder_id: folderId,
							filename: asset.filename,
							mime_type: asset.mime_type,
							size: asset.size,
							sha256: asset.sha256,
							url,
							status: 'completed',
							is_public: isPublic,
							updated_at: new Date()
						});
					} else {
						const createdUpload = await uploadRepository.createWithExplicitId(
							ctx.did,
							asset.local_id,
							{
								key: s3Key,
								owner_id: stringToRecordId.decode(ctx.userId),
								folder_id: folderId,
								filename: asset.filename,
								mime_type: asset.mime_type,
								size: asset.size,
								sha256: asset.sha256,
								url,
								status: 'completed',
								is_public: isPublic,
								created_at: new Date(),
								updated_at: new Date()
							}
						);
						ctx.createdUploadIds.push(createdUpload.id.toString());
					}
					ctx.uploadedS3Keys.push(s3Key);
					zipPathToUrl[asset.zip_path] = url;
					mediaUrls.push(url);
					assetsImported++;
					importedZipPaths.add(asset.zip_path);
				} catch (err) {
					try {
						await s3Service.client.send(
							new DeleteObjectCommand({ Bucket: s3Config.bucket, Key: s3Key })
						);
					} catch {
						// Best-effort S3 cleanup
					}
					console.error('[syncPostsAndProfileFromBundle] Post asset upload failed', {
						zip_path: asset.zip_path,
						error: err instanceof Error ? err.message : String(err)
					});
					throw err;
				}
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
			postsImported++;
			ctx.createdPostIds.push(createdPost.id.toString());
		} catch (err) {
			console.error('[syncPostsAndProfileFromBundle] Post create failed', {
				local_id: post.local_id,
				error: err instanceof Error ? err.message : String(err)
			});
			throw err;
		}
	}

	// Standalone assets
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
				const existing = await uploadRepository.findByCompositeId(ctx.did, asset.local_id);
				if (existing?.url && blobMatches(existing, asset)) {
					zipPathToUrl[asset.zip_path] = existing.url;
					continue;
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
					if (existing && !blobMatches(existing, asset)) {
						await uploadRepository.update(existing.id, {
							key: s3Key,
							owner_id: stringToRecordId.decode(ctx.userId),
							folder_id: folderId,
							filename: asset.filename,
							mime_type: asset.mime_type,
							size: asset.size,
							sha256: asset.sha256,
							url,
							status: 'completed',
							is_public: isPublic,
							updated_at: new Date()
						});
					} else {
						const createdUpload = await uploadRepository.createWithExplicitId(
							ctx.did,
							asset.local_id,
							{
								key: s3Key,
								owner_id: stringToRecordId.decode(ctx.userId),
								folder_id: folderId,
								filename: asset.filename,
								mime_type: asset.mime_type,
								size: asset.size,
								sha256: asset.sha256,
								url,
								status: 'completed',
								is_public: isPublic,
								created_at: new Date(),
								updated_at: new Date()
							}
						);
						ctx.createdUploadIds.push(createdUpload.id.toString());
					}
					ctx.uploadedS3Keys.push(s3Key);
					zipPathToUrl[asset.zip_path] = url;
					assetsImported++;
					importedZipPaths.add(asset.zip_path);
				} catch (err) {
					try {
						await s3Service.client.send(
							new DeleteObjectCommand({ Bucket: s3Config.bucket, Key: s3Key })
						);
					} catch {
						// Best-effort S3 cleanup
					}
					console.error('[syncPostsAndProfileFromBundle] Standalone asset upload failed', {
						zip_path: asset.zip_path,
						error: err instanceof Error ? err.message : String(err)
					});
					throw err;
				}
			}
		} catch (err) {
			if (err instanceof ImportValidationError) throw err;
			console.error('[syncPostsAndProfileFromBundle] assets.json parse/import failed', err);
			throw err;
		}
	}

	/** Extract storage key from upload URL (path after bucket). Returns null if not parseable. */
	const keyFromUrl = (url: string): string | null => {
		try {
			const match = new URL(url).pathname.match(/\/uploads\/.+$/);
			return match ? match[0].slice(1) : null;
		} catch {
			return null;
		}
	};
	/** Convert storage key to zip_path (assets/ prefix, DID segment removed). */
	const keyToZipPath = (key: string): string => `assets/${key.replace(/^uploads\/[^/]+\//, '')}`;

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
							const parsed = z
								.object({ assets: z.array(StandaloneAssetSchema) })
								.parse(JSON.parse(strFromU8(files['assets.json'])));
							return parsed.assets;
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

	const avatarResolved = await resolveAssetUrl(identity.profile.avatarUrl ?? undefined);
	const bannerResolved = await resolveAssetUrl(identity.profile.bannerUrl ?? undefined);
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

	const profileUpdates: {
		display_name?: string;
		bio?: string;
		avatar_url?: string;
		banner_url?: string;
	} = {
		display_name: identity.profile.displayName,
		bio: identity.profile.bio ?? undefined
	};
	if (avatarUrl != null && isValidProfileUrl(avatarUrl)) profileUpdates.avatar_url = avatarUrl;
	if (bannerUrl != null && isValidProfileUrl(bannerUrl)) profileUpdates.banner_url = bannerUrl;

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
