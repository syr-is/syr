import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityController } from '$lib/controllers/identity.controller';
import { postRepository } from '$lib/repositories/post.repository';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { s3Service } from '$lib/services/s3';
import { s3 as s3Config } from '$lib/config';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { zipSync, strToU8 } from 'fflate';
import type { IdentityExportManifest, ExportedPost } from '@syr-is/types';

/**
 * GET /api/identity/export-bundle
 *
 * Export the user's full identity as a portable zip bundle.
 * Contains: manifest.json, identity.json, posts.json, and assets/*.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	try {
		const userId = locals.user.id;

		const identityBundle = await identityController.exportIdentity(userId);

		const { data: posts } = await postRepository.findMany({
			limit: 10000,
			filters: { author_id: userId }
		});

		const { data: uploads } = await uploadRepository.findMany({
			limit: 10000,
			filters: { owner_id: userId }
		});

		const zipFiles: Record<string, Uint8Array> = {};

		const exportedPosts: ExportedPost[] = [];
		const uploadsByUrl = new Map(uploads.map((u) => [u.url, u]));

		for (const post of posts) {
			const postAssets: ExportedPost['assets'] = [];

			if (post.media_urls) {
				for (const mediaUrl of post.media_urls) {
					const upload = uploadsByUrl.get(mediaUrl);
					if (!upload?.key) continue;

					const zipPath = `assets/${upload.key.replace(/^uploads\/[^/]+\//, '')}`;

					try {
						const cmd = new GetObjectCommand({
							Bucket: s3Config.bucket,
							Key: upload.key
						});
						const resp = await s3Service.client.send(cmd);
						if (resp.Body) {
							const bytes = await resp.Body.transformToByteArray();
							zipFiles[zipPath] = bytes;
						}
					} catch {
						// Skip assets that can't be fetched
					}

					postAssets.push({
						filename: upload.filename,
						mime_type: upload.mime_type,
						size: upload.size,
						sha256: upload.sha256,
						zip_path: zipPath
					});
				}
			}

			exportedPosts.push({
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

		const manifest: IdentityExportManifest = {
			version: 1,
			did: identityBundle.did,
			exportedAt: new Date().toISOString(),
			postCount: exportedPosts.length,
			assetCount: Object.keys(zipFiles).length
		};

		zipFiles['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
		zipFiles['identity.json'] = strToU8(JSON.stringify(identityBundle, null, 2));
		zipFiles['posts.json'] = strToU8(JSON.stringify(exportedPosts, null, 2));

		const zipped = zipSync(zipFiles);

		return new Response(zipped, {
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="syr-export-${identityBundle.did.slice(8, 20)}-${Date.now()}.zip"`
			}
		});
	} catch (err) {
		console.error('Identity export-bundle error:', err);

		if (err instanceof Error) {
			if (err.message.includes('no identity') || err.message.includes('no profile')) {
				throw error(404, { code: 'NOT_FOUND', message: err.message });
			}
		}

		throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Export bundle generation failed' });
	}
};
