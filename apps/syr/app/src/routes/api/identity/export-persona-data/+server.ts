import { json, error, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityController } from '$lib/controllers/identity.controller';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { s3Service } from '$lib/services/s3';
import { s3 as s3Config } from '$lib/config';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { Upload } from '@syr-is/types';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB per image
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const;

function extensionFromUrl(url: string): string {
	try {
		const pathname = new URL(url).pathname;
		const ext = pathname.split('.').pop()?.toLowerCase();
		if (ext && IMAGE_EXTENSIONS.includes(ext as (typeof IMAGE_EXTENSIONS)[number])) {
			return ext;
		}
	} catch {
		// invalid URL
	}
	return 'png';
}

function extFromContentType(contentType: string, url: string): string {
	if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
	if (contentType.includes('png')) return 'png';
	if (contentType.includes('gif')) return 'gif';
	if (contentType.includes('webp')) return 'webp';
	return extensionFromUrl(url);
}

async function fetchAssetBytes(
	url: string,
	prefix: 'avatar' | 'banner',
	uploadsByUrl: Map<string, Upload>
): Promise<{ base64: string; filename: string } | null> {
	const upload = uploadsByUrl.get(url);
	if (upload?.key) {
		try {
			const cmd = new GetObjectCommand({
				Bucket: s3Config.bucket,
				Key: upload.key
			});
			const resp = await s3Service.client.send(cmd);
			if (!resp.Body) return null;
			const bytes = await resp.Body.transformToByteArray();
			if (bytes.length > MAX_AVATAR_BYTES) return null;
			const ext = extensionFromUrl(url);
			return {
				base64: Buffer.from(bytes).toString('base64'),
				filename: `${prefix}.${ext}`
			};
		} catch {
			return null;
		}
	}
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
		if (!res.ok) return null;
		const contentType = res.headers.get('content-type') ?? '';
		const bytes = await res.arrayBuffer();
		if (bytes.byteLength > MAX_AVATAR_BYTES) return null;
		const ext = extFromContentType(contentType, url);
		return {
			base64: Buffer.from(bytes).toString('base64'),
			filename: `${prefix}.${ext}`
		};
	} catch {
		return null;
	}
}

/**
 * GET /api/identity/export-persona-data
 *
 * Returns identity bundle plus avatar and banner binaries for persona export.
 * Client assembles zip with .persona extension.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	try {
		const userId = locals.user.id;
		const identityBundle = await identityController.exportIdentity(userId);
		const did = identityBundle.did;

		const uploads: Upload[] = [];
		let uploadNextCursor: { afterCreatedAt: Date; afterDid: string; afterLocalId: string } | null =
			null;
		const maxUploads = 1000;
		do {
			if (uploads.length >= maxUploads) break;
			const page = await uploadRepository.findByDid(did, {
				limit: Math.min(500, maxUploads - uploads.length),
				...(uploadNextCursor && { cursor: uploadNextCursor })
			});
			uploads.push(...page.uploads);
			uploadNextCursor = page.nextCursor;
		} while (uploadNextCursor);

		const uploadsByUrl = new Map(
			uploads.filter((u): u is Upload & { url: string } => !!u.url).map((u) => [u.url, u])
		);

		let avatar_base64: string | undefined;
		let avatar_filename: string | undefined;
		let banner_base64: string | undefined;
		let banner_filename: string | undefined;

		if (identityBundle.profile.avatarUrl) {
			const avatar = await fetchAssetBytes(
				identityBundle.profile.avatarUrl,
				'avatar',
				uploadsByUrl
			);
			if (avatar) {
				avatar_base64 = avatar.base64;
				avatar_filename = avatar.filename;
			}
		}

		if (identityBundle.profile.bannerUrl) {
			const banner = await fetchAssetBytes(
				identityBundle.profile.bannerUrl,
				'banner',
				uploadsByUrl
			);
			if (banner) {
				banner_base64 = banner.base64;
				banner_filename = banner.filename;
			}
		}

		return json({
			status: 'success',
			data: {
				identity: identityBundle,
				avatar_base64: avatar_base64 ?? undefined,
				avatar_filename: avatar_filename ?? undefined,
				banner_base64: banner_base64 ?? undefined,
				banner_filename: banner_filename ?? undefined
			},
			meta: { timestamp: new Date().toISOString() }
		});
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('Export-persona-data error:', err);
		if (err instanceof Error) {
			if (err.message.includes('no identity') || err.message.includes('no profile')) {
				throw error(404, { code: 'NOT_FOUND', message: 'Identity not found' });
			}
		}
		throw error(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch export data' });
	}
};
