import { json, error, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityController } from '$lib/controllers/identity.controller';
import { peekExportToken, consumeExportToken } from '$lib/server/export-verify-store';
import { pinnedPostsController } from '$lib/controllers/pinned-posts.controller';
import { postRepository } from '$lib/repositories/post.repository';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { s3Service } from '$lib/services/s3';
import { s3 as s3Config } from '$lib/config';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { IdentityExportManifest, ExportedPost, Post, Upload } from '@syr-is/types';
import { extractLocalId } from '@syr-is/types';

const MAX_EXPORT_RECORDS = 10_000;
const MAX_EXPORT_ASSET_BYTES = 500 * 1024 * 1024; // 500 MB total base64 asset bytes in export

/** Base64 encoding expands bytes by 4/3 (plus padding). Used to enforce export size limit. */
function base64Size(rawBytes: number): number {
	return Math.ceil((rawBytes * 4) / 3);
}

/** Build S3 URL from storage key. */
function buildUploadUrl(key: string): string {
	return `${s3Config.endpoint}/${s3Config.bucket}/${key}`;
}

/** Extract storage key from upload URL (path after bucket). Returns null if not parseable. */
function keyFromUrl(url: string): string | null {
	try {
		const match = new URL(url).pathname.match(/\/uploads\/.+$/);
		return match ? match[0].slice(1) : null;
	} catch {
		return null;
	}
}

/** Convert storage key to zip_path (assets/ prefix, DID segment removed). */
function keyToZipPath(key: string): string {
	return `assets/${key.replace(/^uploads\/[^/]+\//, '')}`;
}

type ExportBundleResult = {
	manifest: IdentityExportManifest;
	identityBundle: Awaited<ReturnType<typeof identityController.exportIdentity>>;
	exportedPosts: ExportedPost[];
	exportedAssets: Array<{
		zip_path: string;
		local_id: string;
		filename: string;
		mime_type: string;
		size: number;
		sha256?: string;
		content_base64: string;
	}>;
	skippedAssets: Array<{ zip_path: string; url?: string; reason?: string }>;
	pinnedPostIds: string[];
};

async function buildIdentityExport(userId: string): Promise<ExportBundleResult> {
	const identityBundle = await identityController.exportIdentity(userId);
	const did = identityBundle.did;

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

	const uploadsByUrl = new Map(
		uploads
			.filter((u) => u.key)
			.flatMap((u) => {
				const url = u.url ?? buildUploadUrl(u.key!);
				return [[url, u] as const, [u.key!, u] as const];
			})
	);
	const uploadsByKey = new Map(uploads.filter((u) => u.key).map((u) => [u.key!, u]));
	const exportedAssets: ExportBundleResult['exportedAssets'] = [];
	const skippedAssets: ExportBundleResult['skippedAssets'] = [];
	let totalAssetBytes = 0;

	for (const upload of uploads) {
		if (!upload.key) continue;
		const estimatedBase64Size = base64Size(upload.size);
		if (totalAssetBytes + estimatedBase64Size > MAX_EXPORT_ASSET_BYTES) {
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
			if (!resp.Body) {
				skippedAssets.push({
					zip_path: zipPath,
					url: upload.url,
					reason: 'No response body'
				});
				continue;
			}
			const bytes = await resp.Body.transformToByteArray();
			const assetBase64Size = base64Size(bytes.length);
			if (totalAssetBytes + assetBase64Size > MAX_EXPORT_ASSET_BYTES) {
				skippedAssets.push({
					zip_path: zipPath,
					url: upload.url,
					reason: 'Total asset size exceeds limit'
				});
				continue;
			}
			totalAssetBytes += assetBase64Size;
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
				let upload = uploadsByUrl.get(mediaUrl);
				if (!upload?.key) {
					const key = keyFromUrl(mediaUrl);
					if (key) upload = uploadsByKey.get(key);
				}
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

	// Build url→zip_path map so we can transform profile avatar/banner from full URLs to zip paths
	const urlToZipPath = new Map<string, string>();
	for (const u of uploads) {
		if (!u.key) continue;
		const zp = keyToZipPath(u.key);
		urlToZipPath.set(u.url ?? buildUploadUrl(u.key), zp);
		urlToZipPath.set(buildUploadUrl(u.key), zp);
	}
	function resolveProfileUrlToZipPath(url: string): string | null {
		if (urlToZipPath.has(url)) {
			const zp = urlToZipPath.get(url)!;
			return exportedAssetZipPaths.has(zp) ? zp : null;
		}
		const key = keyFromUrl(url);
		if (!key) return null;
		const zp = keyToZipPath(key);
		return exportedAssetZipPaths.has(zp) ? zp : null;
	}
	// Transform identity bundle profile URLs to zip paths for portable import
	const transformedBundle = { ...identityBundle };
	if (transformedBundle.profile) {
		const profile = { ...transformedBundle.profile };
		if (profile.avatarUrl) {
			const zp = resolveProfileUrlToZipPath(profile.avatarUrl);
			if (zp) profile.avatarUrl = zp;
		}
		if (profile.bannerUrl) {
			const zp = resolveProfileUrlToZipPath(profile.bannerUrl);
			if (zp) profile.bannerUrl = zp;
		}
		transformedBundle.profile = profile;
	}

	const manifest: IdentityExportManifest = {
		version: 1,
		did: identityBundle.did,
		exportedAt: new Date().toISOString(),
		postCount: exportedPosts.length,
		assetCount: exportedAssets.length
	};

	return {
		manifest,
		identityBundle: transformedBundle,
		exportedPosts,
		exportedAssets,
		skippedAssets,
		pinnedPostIds
	};
}

async function resolveUserId(
	locals: { user?: { id: string } },
	exportToken: string | null
): Promise<{ userId: string; tokenToConsume: string | null }> {
	let userId: string | null = locals.user?.id ?? null;
	let tokenToConsume: string | null = null;
	if (exportToken) {
		userId = await peekExportToken(exportToken);
		if (!userId) {
			throw error(403, { code: 'INVALID_TOKEN', message: 'Export token invalid or expired' });
		}
		tokenToConsume = exportToken;
	}
	if (!userId) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}
	return { userId, tokenToConsume };
}

/**
 * GET /api/identity/export-bundle-data
 *
 * Returns manifest, identity, posts, and assets (no key) for client-side export.
 * Auth: session (locals.user) or one-time export_token query param (from Syner verification).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const exportToken = url.searchParams.get('export_token');
	const { userId, tokenToConsume } = await resolveUserId(locals, exportToken);

	try {
		if (tokenToConsume) {
			const consumed = await consumeExportToken(tokenToConsume);
			if (!consumed) {
				return json(
					{
						status: 'error',
						error: { code: 'TOKEN_ALREADY_USED', message: 'Export token was already used' }
					},
					{ status: 409 }
				);
			}
		}
		const result = await buildIdentityExport(userId);
		return json({
			status: 'success',
			data: {
				manifest: result.manifest,
				identity: result.identityBundle,
				posts: result.exportedPosts,
				assets: result.exportedAssets,
				skipped_assets: result.skippedAssets.length > 0 ? result.skippedAssets : undefined,
				pinned_posts: { post_ids: result.pinnedPostIds }
			},
			meta: { timestamp: new Date().toISOString() }
		});
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('Export-bundle-data error:', err);
		if (err instanceof Error) {
			if (err.message.includes('no identity') || err.message.includes('no profile')) {
				console.error('Export-bundle-data identity not found:', err.message);
				throw error(404, { code: 'NOT_FOUND', message: 'Identity not found' });
			}
		}
		throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch export data' });
	}
};

/**
 * POST /api/identity/export-bundle-data
 *
 * Same as GET but export_token is read from JSON body { export_token }.
 * Prefer this over GET to avoid token in URL.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	let body: { export_token?: string };
	try {
		body = await request.json();
	} catch {
		throw error(400, { code: 'INVALID_REQUEST', message: 'Invalid JSON body' });
	}
	const exportToken =
		typeof body?.export_token === 'string' && body.export_token.trim()
			? body.export_token.trim()
			: null;
	const { userId, tokenToConsume } = await resolveUserId(locals, exportToken);

	try {
		if (tokenToConsume) {
			const consumed = await consumeExportToken(tokenToConsume);
			if (!consumed) {
				return json(
					{
						status: 'error',
						error: { code: 'TOKEN_ALREADY_USED', message: 'Export token was already used' }
					},
					{ status: 409 }
				);
			}
		}
		const result = await buildIdentityExport(userId);
		return json({
			status: 'success',
			data: {
				manifest: result.manifest,
				identity: result.identityBundle,
				posts: result.exportedPosts,
				assets: result.exportedAssets,
				skipped_assets: result.skippedAssets.length > 0 ? result.skippedAssets : undefined,
				pinned_posts: { post_ids: result.pinnedPostIds }
			},
			meta: { timestamp: new Date().toISOString() }
		});
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('Export-bundle-data POST error:', err);
		if (err instanceof Error) {
			if (err.message.includes('no identity') || err.message.includes('no profile')) {
				console.error('Export-bundle-data identity not found:', err.message);
				throw error(404, { code: 'NOT_FOUND', message: 'Identity not found' });
			}
		}
		throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch export data' });
	}
};
