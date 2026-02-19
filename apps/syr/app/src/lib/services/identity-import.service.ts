import { error } from '@sveltejs/kit';
import { unzip, strFromU8 } from 'fflate';
import { decodePublicKey, constantTimeEqual, canonicalize } from '@syr-is/crypto';
import { parseDid } from '@syr-is/did';
import type { AegisBundle } from '@syr-is/crypto/aegis';
import {
	IdentityExportManifestSchema,
	IdentityExportBundleSchema,
	ExportedPostSchema,
	AssetZipPathSchema,
	stringToRecordId
} from '@syr-is/types';
import { z } from 'zod';
import { identityRepository, delegatedKeyRepository } from '$lib/repositories/identity.repository';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { postRepository } from '$lib/repositories/post.repository';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { kvService } from '$lib/services/kv';
import { s3Service } from '$lib/services/s3';
import { s3 as s3Config } from '$lib/config';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_UNCOMPRESSED_BYTES = MAX_UPLOAD_BYTES * 10; // 1 GB — zip-bomb protection

const StandaloneAssetSchema = z.object({
	zip_path: AssetZipPathSchema,
	local_id: z.string(),
	filename: z.string(),
	mime_type: z.string(),
	size: z.number(),
	sha256: z.string().optional()
});

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

/**
 * Validate bundle: DID match, public key match, Aegis bundle match, no duplicate DID on instance.
 */
export async function validateBundle(
	parsed: ParsedBundle,
	aegisBundle: AegisBundle
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

	const existingDid = await identityRepository.findByDid(identity.did);
	if (existingDid) {
		throw error(409, {
			code: 'DID_EXISTS',
			message: 'An identity with this DID already exists on this instance'
		});
	}

	return identity.did;
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
	await profileRepository.mergeByUserId(ctx.userId, {
		display_name: identity.profile.displayName,
		bio: identity.profile.bio ?? undefined,
		avatar_url: identity.profile.avatarUrl ?? undefined,
		banner_url: identity.profile.bannerUrl ?? undefined
	});

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
 * Import posts and their assets. Mutates ctx. Returns import stats and zip paths for standalone asset dedup.
 */
export async function importPostsAndAssets(
	ctx: ImportContext,
	parsed: ParsedBundle
): Promise<{ postsImported: number; assetsImported: number; importedZipPaths: Set<string> }> {
	const { files, posts } = parsed;
	const importedZipPaths = new Set<string>();
	let postsImported = 0;
	let assetsImported = 0;

	for (const post of posts) {
		const mediaUrls: string[] = [];

		if (post.assets) {
			for (const asset of post.assets) {
				const assetData = files[asset.zip_path];
				if (!assetData) continue;

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

					const createdUpload = await uploadRepository.createWithExplicitId(
						ctx.did,
						asset.local_id,
						{
							key: s3Key,
							owner_id: stringToRecordId.decode(ctx.userId),
							filename: asset.filename,
							mime_type: asset.mime_type,
							size: asset.size,
							sha256: asset.sha256,
							url,
							status: 'completed',
							is_public: true,
							created_at: new Date(),
							updated_at: new Date()
						}
					);
					ctx.createdUploadIds.push(createdUpload.id.toString());

					mediaUrls.push(url);
					assetsImported++;
					importedZipPaths.add(asset.zip_path);
				} catch {
					// Skip assets that fail to upload
				}
			}
		}

		const createdPost = await postRepository.createWithExplicitId(ctx.did, post.local_id, {
			type: post.type,
			content_type: post.content_type,
			title: post.title,
			description: post.description,
			content: post.content,
			media_urls: mediaUrls.length > 0 ? mediaUrls : undefined,
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
	importedZipPaths: Set<string>
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
			if (!assetData) continue;

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
				const createdUpload = await uploadRepository.createWithExplicitId(ctx.did, asset.local_id, {
					key: s3Key,
					owner_id: stringToRecordId.decode(ctx.userId),
					filename: asset.filename,
					mime_type: asset.mime_type,
					size: asset.size,
					sha256: asset.sha256,
					url,
					status: 'completed',
					is_public: true,
					created_at: new Date(),
					updated_at: new Date()
				});
				ctx.createdUploadIds.push(createdUpload.id.toString());
				assetsImported++;
				importedZipPaths.add(asset.zip_path);
			} catch {
				// Skip assets that fail to upload
			}
		}
		return assetsImported;
	} catch {
		return 0;
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
