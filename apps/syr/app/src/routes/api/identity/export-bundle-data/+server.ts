import { json, error, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityController } from '$lib/controllers/identity.controller';
import { pinnedPostsController } from '$lib/controllers/pinned-posts.controller';
import { postRepository } from '$lib/repositories/post.repository';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { s3Service } from '$lib/services/s3';
import { s3 as s3Config } from '$lib/config';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { IdentityExportManifest, ExportedPost, Post, Upload } from '@syr-is/types';
import { extractLocalId } from '@syr-is/types';

const MAX_EXPORT_RECORDS = 10_000;
const MAX_EXPORT_ASSET_BYTES = 500 * 1024 * 1024; // 500 MB total asset bytes

/**
 * GET /api/identity/export-bundle-data
 *
 * Returns manifest, identity, posts, and assets (no key) for client-side export.
 * The client creates Sigil from seed (decrypted in browser), assembles zip with identity.sigil,
 * and downloads.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	try {
		const userId = locals.user.id;
		const identityBundle = await identityController.exportIdentity(userId);
		const did = identityBundle.did;

		// Query posts (cursor-based, with record cap)
		const posts: Post[] = [];
		let postNextCursor: { afterCreatedAt: Date; afterDid: string; afterLocalId: string } | null =
			null;
		do {
			if (posts.length >= MAX_EXPORT_RECORDS) break;
			const page = await postRepository.findByDid(did, {
				limit: Math.min(500, MAX_EXPORT_RECORDS - posts.length),
				...(postNextCursor && { cursor: postNextCursor })
			});
			posts.push(...page.posts);
			postNextCursor = page.nextCursor;
		} while (postNextCursor && posts.length < MAX_EXPORT_RECORDS);

		// Fetch uploads (cursor-based, with record cap)
		const uploads: Upload[] = [];
		let uploadNextCursor: { afterCreatedAt: Date; afterDid: string; afterLocalId: string } | null =
			null;
		do {
			if (uploads.length >= MAX_EXPORT_RECORDS) break;
			const page = await uploadRepository.findByDid(did, {
				limit: Math.min(500, MAX_EXPORT_RECORDS - uploads.length),
				...(uploadNextCursor && { cursor: uploadNextCursor })
			});
			uploads.push(...page.uploads);
			uploadNextCursor = page.nextCursor;
		} while (uploadNextCursor && uploads.length < MAX_EXPORT_RECORDS);

		const uploadsByUrl = new Map(uploads.map((u) => [u.url, u]));
		const exportedAssets: Array<{
			zip_path: string;
			local_id: string;
			filename: string;
			mime_type: string;
			size: number;
			sha256?: string;
			content_base64: string;
		}> = [];
		const skippedAssets: Array<{ zip_path: string; url?: string; reason?: string }> = [];
		let totalAssetBytes = 0;

		for (const upload of uploads) {
			if (!upload.key) continue;
			if (totalAssetBytes + upload.size > MAX_EXPORT_ASSET_BYTES) {
				skippedAssets.push({
					zip_path: `assets/${upload.key.replace(/^uploads\/[^/]+\//, '')}`,
					url: upload.url,
					reason: 'Total asset size exceeds limit'
				});
				continue;
			}
			const zipPath = `assets/${upload.key.replace(/^uploads\/[^/]+\//, '')}`;
			try {
				const cmd = new GetObjectCommand({
					Bucket: s3Config.bucket,
					Key: upload.key
				});
				const resp = await s3Service.client.send(cmd);
				if (resp.Body) {
					const bytes = await resp.Body.transformToByteArray();
					totalAssetBytes += bytes.length;
					if (totalAssetBytes > MAX_EXPORT_ASSET_BYTES) {
						skippedAssets.push({
							zip_path: zipPath,
							url: upload.url,
							reason: 'Total asset size exceeds limit'
						});
						continue;
					}
					const base64 = Buffer.from(bytes).toString('base64');
					exportedAssets.push({
						zip_path: zipPath,
						local_id: extractLocalId(upload.id),
						filename: upload.filename,
						mime_type: upload.mime_type,
						size: upload.size,
						sha256: upload.sha256,
						content_base64: base64
					});
				}
			} catch (err) {
				skippedAssets.push({
					zip_path: zipPath,
					url: upload.url,
					reason: err instanceof Error ? err.message : 'Fetch failed'
				});
			}
		}

		const exportedAssetZipPaths = new Set(exportedAssets.map((a) => a.zip_path));
		const exportedPosts: ExportedPost[] = [];
		for (const post of posts) {
			const postAssets: ExportedPost['assets'] = [];
			if (post.media_urls) {
				for (const mediaUrl of post.media_urls) {
					const upload = uploadsByUrl.get(mediaUrl);
					if (!upload?.key) continue;
					const zipPath = `assets/${upload.key.replace(/^uploads\/[^/]+\//, '')}`;
					if (exportedAssetZipPaths.has(zipPath)) {
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

		const pinnedPostIds = await pinnedPostsController.getPinnedPostIds(userId);

		const manifest: IdentityExportManifest = {
			version: 1,
			did: identityBundle.did,
			exportedAt: new Date().toISOString(),
			postCount: exportedPosts.length,
			assetCount: exportedAssets.length
		};

		return json({
			status: 'success',
			data: {
				manifest,
				identity: identityBundle,
				posts: exportedPosts,
				assets: exportedAssets,
				skipped_assets: skippedAssets.length > 0 ? skippedAssets : undefined,
				pinned_posts: { post_ids: pinnedPostIds }
			},
			meta: { timestamp: new Date().toISOString() }
		});
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('Export-bundle-data error:', err);
		if (err instanceof Error) {
			if (err.message.includes('no identity') || err.message.includes('no profile')) {
				throw error(404, { code: 'NOT_FOUND', message: err.message });
			}
		}
		throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch export data' });
	}
};
