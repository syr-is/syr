import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { unzipSync, strFromU8 } from 'fflate';
import { verify, canonicalize, decodePublicKey } from '@syr-is/crypto';
import { parseDid, buildDidDocument } from '@syr-is/did';
import {
	IdentityExportManifestSchema,
	IdentityExportBundleSchema,
	ExportedPostSchema
} from '@syr-is/types';
import { z } from 'zod';
import { identityRepository, delegatedKeyRepository } from '$lib/repositories/identity.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { postRepository } from '$lib/repositories/post.repository';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { s3Service } from '$lib/services/s3';
import { s3 as s3Config } from '$lib/config';
import { PutObjectCommand } from '@aws-sdk/client-s3';

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

	if (!file || !(file instanceof File)) {
		throw error(400, {
			code: 'INVALID_REQUEST',
			message: 'Missing "bundle" file in form data'
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

	const manifest = IdentityExportManifestSchema.parse(
		JSON.parse(strFromU8(files['manifest.json']))
	);
	const identity = IdentityExportBundleSchema.parse(
		JSON.parse(strFromU8(files['identity.json']))
	);
	const posts = z
		.array(ExportedPostSchema)
		.parse(JSON.parse(strFromU8(files['posts.json'])));

	if (manifest.did !== identity.did) {
		throw error(400, {
			code: 'DID_MISMATCH',
			message: 'Manifest DID does not match identity DID'
		});
	}

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

	try {
		const identityRecord = await identityRepository.create({
			did: identity.did,
			public_key: identity.publicKey,
			user_id: userId,
			created_at: new Date()
		});

		await profileRepository.createByUserId(userId);
		await profileRepository.mergeByUserId(userId, {
			display_name: identity.profile.displayName,
			bio: identity.profile.bio ?? undefined,
			avatar_url: identity.profile.avatarUrl ?? undefined,
			banner_url: identity.profile.bannerUrl ?? undefined
		});

		for (const dk of identity.delegatedKeys) {
			await delegatedKeyRepository.create({
				did: identity.did,
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

		for (const post of posts) {
			const mediaUrls: string[] = [];

			if (post.assets) {
				for (const asset of post.assets) {
					const assetData = files[asset.zip_path];
					if (!assetData) continue;

					const s3Key = `uploads/${identityRecord.id}/${asset.zip_path.replace(/^assets\//, '')}`;

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

						const upload = await uploadRepository.create({
							key: s3Key,
							owner_id: userId,
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

						mediaUrls.push(url);
						assetsImported++;
					} catch {
						// Skip assets that fail to upload
					}
				}
			}

			await postRepository.create({
				type: post.type,
				content_type: post.content_type,
				title: post.title,
				description: post.description,
				content: post.content,
				media_urls: mediaUrls.length > 0 ? mediaUrls : post.media_urls,
				display_mode: post.display_mode,
				visibility: post.visibility,
				status: post.status,
				author_id: userId,
				created_at: new Date(post.created_at),
				updated_at: new Date()
			});

			postsImported++;
		}

		return json({
			status: 'success',
			data: {
				did: identity.did,
				postsImported,
				assetsImported
			}
		});
	} catch (err) {
		console.error('Identity import error:', err);
		throw error(500, {
			code: 'IMPORT_FAILED',
			message: 'Identity import failed. The operation may have partially completed.'
		});
	}
};
