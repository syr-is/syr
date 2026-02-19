import { error, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityController } from '$lib/controllers/identity.controller';
import { pinnedPostsController } from '$lib/controllers/pinned-posts.controller';
import { postRepository } from '$lib/repositories/post.repository';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { s3Service } from '$lib/services/s3';
import { s3 as s3Config } from '$lib/config';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { zip, strToU8 } from 'fflate';
import type { IdentityExportManifest, ExportedPost, Post } from '@syr-is/types';
import { extractLocalId } from '@syr-is/types';
import { exportPrivateKeyToEncryptedPem } from '@syr-is/crypto/pem';

/**
 * GET returns 405 — use POST with { passphrase } in JSON body.
 */
export const GET: RequestHandler = async () => {
	throw error(405, {
		code: 'METHOD_NOT_ALLOWED',
		message:
			'Use POST with JSON body { passphrase: string } to export. The private key is stored as encrypted PKCS#8 PEM.'
	});
};

/**
 * POST /api/identity/export-bundle
 *
 * Export the user's full identity as a portable zip bundle.
 * Contains: manifest.json, identity.json, posts.json, assets.json, pinned_posts.json, and assets/*.
 * When the identity has a server-managed private key, includes private_key.pem (PKCS#8 encrypted).
 *
 * Body: { passphrase: string } - required when exporting a private key (min 8 chars).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	try {
		const userId = locals.user.id;

		const identityBundle = await identityController.exportIdentity(userId);
		const did = identityBundle.did;

		// Fetch private key separately (server-managed identities only)
		let privateKeyMultibase: string | undefined;
		try {
			const keys = await identityController.exportKeys(userId);
			privateKeyMultibase = keys.privateKey;
		} catch {
			// No private key (e.g. Syner-managed)
		}

		// If we have a private key, we need a passphrase to encrypt it
		let privateKeyPem: string | undefined;
		if (privateKeyMultibase) {
			let passphrase: string;
			try {
				const body = await request.json().catch(() => ({}));
				passphrase = typeof body?.passphrase === 'string' ? body.passphrase : '';
			} catch {
				passphrase = '';
			}
			if (!passphrase || passphrase.length < 8) {
				throw error(400, {
					code: 'PASSPHRASE_REQUIRED',
					message: 'A passphrase of at least 8 characters is required to encrypt the private key.'
				});
			}
			privateKeyPem = exportPrivateKeyToEncryptedPem(privateKeyMultibase, passphrase);
		}

		// Query by DID (composite id.created_by) for reliable results (paginated)
		const posts: Post[] = [];
		let nextCursor: { afterCreatedAt: Date; afterId: string } | null = null;
		do {
			const page = await postRepository.findByDid(did, {
				limit: 500,
				afterCreatedAt: nextCursor?.afterCreatedAt,
				afterId: nextCursor?.afterId
			});
			posts.push(...page.posts);
			nextCursor = page.nextCursor;
		} while (nextCursor);

		// Fetch uploads in pages to avoid unbounded memory (same pattern as posts)
		const uploads: Awaited<ReturnType<typeof uploadRepository.findByDid>> = [];
		let uploadNextCursor: { offset: number } | null = null;
		do {
			const page = await uploadRepository.findByDidPage(did, {
				limit: 500,
				offset: uploadNextCursor?.offset
			});
			uploads.push(...page.uploads);
			uploadNextCursor = page.nextCursor;
		} while (uploadNextCursor);

		const zipFiles: Record<string, Uint8Array> = {};
		const uploadsByUrl = new Map(uploads.map((u) => [u.url, u]));
		const exportedAssets: Array<{
			zip_path: string;
			local_id: string;
			filename: string;
			mime_type: string;
			size: number;
			sha256?: string;
		}> = [];

		// Add ALL uploads to zip (including standalone uploads not in any post)
		for (const upload of uploads) {
			if (!upload.key) continue;
			const zipPath = `assets/${upload.key.replace(/^uploads\/[^/]+\//, '')}`;
			if (zipPath in zipFiles) continue; // avoid duplicates

			try {
				const cmd = new GetObjectCommand({
					Bucket: s3Config.bucket,
					Key: upload.key
				});
				const resp = await s3Service.client.send(cmd);
				if (resp.Body) {
					const bytes = await resp.Body.transformToByteArray();
					zipFiles[zipPath] = bytes;
					exportedAssets.push({
						zip_path: zipPath,
						local_id: extractLocalId(upload.id),
						filename: upload.filename,
						mime_type: upload.mime_type,
						size: upload.size,
						sha256: upload.sha256
					});
				}
			} catch {
				// Skip assets that can't be fetched
			}
		}

		const exportedPosts: ExportedPost[] = [];
		for (const post of posts) {
			const postAssets: ExportedPost['assets'] = [];

			if (post.media_urls) {
				for (const mediaUrl of post.media_urls) {
					const upload = uploadsByUrl.get(mediaUrl);
					if (!upload?.key) continue;

					const zipPath = `assets/${upload.key.replace(/^uploads\/[^/]+\//, '')}`;

					// Only add to postAssets when the asset was successfully fetched and written to zipFiles
					if (zipPath in zipFiles) {
						postAssets.push({
							local_id: extractLocalId(upload.id),
							filename: upload.filename,
							mime_type: upload.mime_type,
							size: upload.size,
							sha256: upload.sha256,
							zip_path: zipPath
						});
					}
				}
			}

			exportedPosts.push({
				local_id: extractLocalId(post.id),
				type: post.type,
				content_type: post.content_type,
				title: post.title,
				description: post.description,
				content: post.content,
				media_urls: post.media_urls,
				display_mode: post.display_mode,
				visibility: post.visibility,
				status: post.status,
				created_at: post.created_at.toISOString(),
				assets: postAssets.length > 0 ? postAssets : undefined
			});
		}

		// Fetch pinned post IDs (canonical did/localId format)
		const pinnedPostIds = await pinnedPostsController.getPinnedPostIds(userId);

		const manifest: IdentityExportManifest = {
			version: 1,
			did: identityBundle.did,
			exportedAt: new Date().toISOString(),
			postCount: exportedPosts.length,
			assetCount: exportedAssets.length
		};

		zipFiles['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
		zipFiles['identity.json'] = strToU8(JSON.stringify(identityBundle, null, 2));
		zipFiles['posts.json'] = strToU8(JSON.stringify(exportedPosts, null, 2));
		zipFiles['assets.json'] = strToU8(JSON.stringify({ assets: exportedAssets }, null, 2));
		zipFiles['pinned_posts.json'] = strToU8(JSON.stringify({ post_ids: pinnedPostIds }, null, 2));
		if (privateKeyPem) {
			zipFiles['private_key.pem'] = strToU8(privateKeyPem);
		}

		const zipped = await new Promise<Uint8Array>((resolve, reject) => {
			zip(zipFiles, { level: 1 }, (err, data) => {
				if (err) reject(err);
				else resolve(data ?? new Uint8Array(0));
			});
		});

		return new Response(new Blob([zipped as BlobPart]), {
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="syr-export-${identityBundle.did.slice(8, 20)}-${Date.now()}.zip"`
			}
		});
	} catch (err) {
		if (isHttpError(err)) throw err;

		console.error('Identity export-bundle error:', err);

		if (err instanceof Error) {
			if (err.message.includes('no identity') || err.message.includes('no profile')) {
				throw error(404, { code: 'NOT_FOUND', message: err.message });
			}
		}

		throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Export bundle generation failed' });
	}
};
