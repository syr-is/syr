import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { unzipSync, strFromU8 } from 'fflate';
import { decodePublicKey } from '@syr-is/crypto';
import { importPrivateKeyFromEncryptedPem } from '@syr-is/crypto/pem';
import { parseDid } from '@syr-is/did';
import {
	IdentityExportManifestSchema,
	IdentityExportBundleSchema,
	ExportedPostSchema,
	stringToRecordId
} from '@syr-is/types';
import { z } from 'zod';
import { identityRepository, delegatedKeyRepository } from '$lib/repositories/identity.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { postRepository } from '$lib/repositories/post.repository';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { kvService } from '$lib/services/kv';
import { s3Service } from '$lib/services/s3';
import { s3 as s3Config } from '$lib/config';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

/**
 * POST /api/identity/import
 *
 * Import a full identity bundle from a zip file.
 * The user must already be authenticated (registered with a new account).
 * This associates the imported identity, profile, posts, and assets
 * with the authenticated user.
 *
 * Expects: multipart/form-data with a "bundle" file field containing the zip.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	const userId = locals.user.id;

	const existingIdentity = await identityRepository.findByUserId(userId);
	if (existingIdentity) {
		throw error(409, {
			code: 'IDENTITY_EXISTS',
			message: 'User already has an identity. Import is only available for new accounts.'
		});
	}

	const formData = await request.formData();
	const file = formData.get('bundle');
	const passphrase = String(formData.get('passphrase') ?? '').trim();

	if (!file || !(file instanceof File)) {
		throw error(400, {
			code: 'INVALID_REQUEST',
			message: 'Missing "bundle" file in form data'
		});
	}

	const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
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
		files = unzipSync(zipBytes);
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
		throw error(400, {
			code: 'INVALID_IMPORT',
			message: msg
		});
	}

	if (manifest.did !== identity.did) {
		throw error(400, {
			code: 'DID_MISMATCH',
			message: 'Manifest DID does not match identity DID'
		});
	}

	let did: string;
	try {
		const parsed = parseDid(identity.did);
		const pubKeyFromDid = parsed.publicKey;
		const pubKeyFromBundle = decodePublicKey(identity.publicKey);

		const keysMatch = pubKeyFromDid.every((b, i) => b === pubKeyFromBundle[i]);
		if (!keysMatch || pubKeyFromDid.length !== pubKeyFromBundle.length) {
			throw error(400, {
				code: 'KEY_MISMATCH',
				message: 'Public key in bundle does not match the DID'
			});
		}

		const existingDid = await identityRepository.findByDid(identity.did);
		if (existingDid) {
			throw error(409, {
				code: 'DID_EXISTS',
				message: 'An identity with this DID already exists on this instance'
			});
		}
		did = identity.did;
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		throw error(400, {
			code: 'IMPORT_FAILED',
			message: 'Failed to validate DID/public key'
		});
	}
	const uploadedS3Keys: string[] = [];
	let createdProfile: Awaited<ReturnType<typeof profileRepository.createByUserId>> = null;
	const createdPostIds: string[] = [];
	const createdUploadIds: string[] = [];
	let pinnedPostsRestored = false;

	try {
		// Read private key from separate file (keeps identity.json spec-compliant)
		// New format: private_key.pem (PKCS#8 encrypted). Legacy: private_key.json.
		let privateKey: string | undefined;
		const privateKeyPem = files['private_key.pem'];
		if (privateKeyPem) {
			try {
				if (!passphrase || passphrase.length < 8) {
					throw error(400, {
						code: 'PASSPHRASE_REQUIRED',
						message:
							'This bundle contains an encrypted private key. Provide the passphrase you set during export.'
					});
				}
				const pemStr = strFromU8(privateKeyPem);
				privateKey = importPrivateKeyFromEncryptedPem(pemStr, passphrase);
			} catch (err) {
				if (err && typeof err === 'object' && 'status' in err) throw err;
				throw error(400, {
					code: 'INVALID_PASSPHRASE',
					message: 'Wrong passphrase or invalid private_key.pem.'
				});
			}
		} else {
			// Legacy: unencrypted private_key.json (deprecated)
			const privateKeyPayload = files['private_key.json'];
			if (privateKeyPayload) {
				try {
					const keysData = z
						.object({ privateKey: z.string(), did: z.string() })
						.parse(JSON.parse(strFromU8(privateKeyPayload)));
					if (keysData.did === did) {
						privateKey = keysData.privateKey;
					}
				} catch {
					// Ignore malformed private_key.json
				}
			}
		}
		await identityRepository.create({
			did,
			public_key: identity.publicKey,
			user_id: stringToRecordId.decode(userId),
			created_at: new Date(),
			...(typeof privateKey === 'string' && privateKey.length > 0
				? { private_key: privateKey }
				: {})
		});

		createdProfile = await profileRepository.createByUserId(userId);
		await profileRepository.mergeByUserId(userId, {
			display_name: identity.profile.displayName,
			bio: identity.profile.bio ?? undefined,
			avatar_url: identity.profile.avatarUrl ?? undefined,
			banner_url: identity.profile.bannerUrl ?? undefined
		});

		for (const dk of identity.delegatedKeys) {
			await delegatedKeyRepository.create({
				did,
				public_key: dk.publicKey,
				scope: dk.scope,
				signature: dk.signature,
				created_at: new Date(dk.createdAt),
				expires_at: dk.expiresAt ? new Date(dk.expiresAt) : undefined,
				revoked_at: dk.revokedAt ? new Date(dk.revokedAt) : undefined
			});
		}

		let postsImported = 0;
		let assetsImported = 0;

		// Track which zip_paths we've already imported (from posts)
		const importedZipPaths = new Set<string>();

		for (const post of posts) {
			const mediaUrls: string[] = [];

			if (post.assets) {
				for (const asset of post.assets) {
					const assetData = files[asset.zip_path];
					if (!assetData) continue;

					// Use DID-based S3 key: uploads/{did}/{path}
					const s3Key = `uploads/${did}/${asset.zip_path.replace(/^assets\//, '')}`;

					try {
						await s3Service.client.send(
							new PutObjectCommand({
								Bucket: s3Config.bucket,
								Key: s3Key,
								Body: assetData,
								ContentType: asset.mime_type
							})
						);
						uploadedS3Keys.push(s3Key);

						const url = `${s3Config.endpoint}/${s3Config.bucket}/${s3Key}`;

						// Recreate upload with explicit composite ID preserving the original local_id
						const createdUpload = await uploadRepository.createWithExplicitId(did, asset.local_id, {
							key: s3Key,
							owner_id: stringToRecordId.decode(userId),
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
						createdUploadIds.push(createdUpload.id.toString());

						mediaUrls.push(url);
						assetsImported++;
						importedZipPaths.add(asset.zip_path);
					} catch {
						// Skip assets that fail to upload
					}
				}
			}

			// Recreate post with explicit composite ID preserving the original local_id
			const createdPost = await postRepository.createWithExplicitId(did, post.local_id, {
				type: post.type,
				content_type: post.content_type,
				title: post.title,
				description: post.description,
				content: post.content,
				media_urls: mediaUrls.length > 0 ? mediaUrls : undefined,
				display_mode: post.display_mode,
				visibility: post.visibility,
				status: post.status,
				author_id: stringToRecordId.decode(userId),
				created_at: new Date(post.created_at),
				updated_at: new Date()
			});
			createdPostIds.push(createdPost.id.toString());

			postsImported++;
		}

		// Import standalone assets from assets.json (not referenced in any post)
		const assetsPayload = files['assets.json'];
		if (assetsPayload) {
			try {
				const parsed = z
					.object({
						assets: z.array(
							z.object({
								zip_path: z.string(),
								local_id: z.string(),
								filename: z.string(),
								mime_type: z.string(),
								size: z.number(),
								sha256: z.string().optional()
							})
						)
					})
					.parse(JSON.parse(strFromU8(assetsPayload)));
				for (const asset of parsed.assets) {
					if (importedZipPaths.has(asset.zip_path)) continue;
					const assetData = files[asset.zip_path];
					if (!assetData) continue;

					const s3Key = `uploads/${did}/${asset.zip_path.replace(/^assets\//, '')}`;
					try {
						await s3Service.client.send(
							new PutObjectCommand({
								Bucket: s3Config.bucket,
								Key: s3Key,
								Body: assetData,
								ContentType: asset.mime_type
							})
						);
						uploadedS3Keys.push(s3Key);
						const url = `${s3Config.endpoint}/${s3Config.bucket}/${s3Key}`;
						const createdUpload = await uploadRepository.createWithExplicitId(did, asset.local_id, {
							key: s3Key,
							owner_id: stringToRecordId.decode(userId),
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
						createdUploadIds.push(createdUpload.id.toString());
						assetsImported++;
						importedZipPaths.add(asset.zip_path);
					} catch {
						// Skip assets that fail to upload
					}
				}
			} catch {
				// Ignore malformed assets.json
			}
		}

		// Restore pinned posts if present in bundle
		let pinnedRestored = 0;
		const pinnedPayload = files['pinned_posts.json'];
		if (pinnedPayload) {
			try {
				const parsed = z
					.object({ post_ids: z.array(z.string()) })
					.parse(JSON.parse(strFromU8(pinnedPayload)));
				if (parsed.post_ids.length > 0) {
					// Filter to IDs that exist in our imported posts (same did/local_id)
					const importedIds = new Set(posts.map((p) => `${did}/${p.local_id}`));
					const validPinned = parsed.post_ids.filter((id) => importedIds.has(id));
					if (validPinned.length > 0) {
						const index = String(userId);
						await kvService.set('pinned_posts', index, { post_ids: validPinned });
						pinnedPostsRestored = true;
						pinnedRestored = validPinned.length;
					}
				}
			} catch {
				// Ignore malformed pinned_posts.json
			}
		}

		return json({
			status: 'success',
			data: {
				did,
				postsImported,
				assetsImported,
				pinnedRestored
			}
		});
	} catch (err) {
		// Re-throw SvelteKit HttpError (from error()) so intended HTTP responses propagate
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		console.error('Identity import error:', err);
		// Rollback: remove DB records created during partial import (reverse order of creation)
		// Each deletion wrapped in try/catch so one failure doesn't skip subsequent cleanup
		if (pinnedPostsRestored) {
			try {
				await kvService.delete('pinned_posts', String(userId));
			} catch (e) {
				console.error('Rollback: failed to delete pinned_posts', e);
			}
		}
		for (const uploadId of createdUploadIds) {
			try {
				await uploadRepository.delete(uploadId);
			} catch {
				// Best-effort per-record cleanup
			}
		}
		for (const postId of createdPostIds) {
			try {
				await postRepository.delete(postId);
			} catch {
				// Best-effort per-record cleanup
			}
		}
		try {
			await delegatedKeyRepository.deleteByDid(did);
		} catch (e) {
			console.error('Rollback: failed to delete delegated keys', e);
		}
		if (createdProfile) {
			try {
				await profileRepository.delete(createdProfile.id);
			} catch {
				// Best-effort
			}
		}
		try {
			await identityRepository.deleteByDid(did);
		} catch (e) {
			console.error('Rollback: failed to delete identity', e);
		}
		// Best-effort S3 cleanup
		for (const key of uploadedS3Keys) {
			try {
				await s3Service.client.send(new DeleteObjectCommand({ Bucket: s3Config.bucket, Key: key }));
			} catch {
				// Best-effort
			}
		}
		throw error(500, {
			code: 'IMPORT_FAILED',
			message: 'Identity import failed. The operation may have partially completed.'
		});
	}
};
