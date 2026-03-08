import { json, error, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	peekExportToken,
	consumeExportToken,
	peekExportSignedBundle,
	consumeExportSignedBundle
} from '$lib/server/export-verify-store';
import { buildIdentityExport } from '$lib/server/export-bundle';

type ResolveResult =
	| {
			mode: 'signed';
			bundle: Awaited<ReturnType<typeof peekExportSignedBundle>>;
			tokenToConsume: string;
	  }
	| { mode: 'build'; userId: string; tokenToConsume: string | null };

async function resolveExport(
	locals: { user?: { id: string } },
	exportToken: string | null
): Promise<ResolveResult> {
	let userId: string | null = locals.user?.id ?? null;
	let tokenToConsume: string | null = null;
	if (exportToken) {
		const signedBundle = await peekExportSignedBundle(exportToken);
		if (signedBundle) {
			return { mode: 'signed', bundle: signedBundle, tokenToConsume: exportToken };
		}
		userId = await peekExportToken(exportToken);
		if (!userId) {
			throw error(403, { code: 'INVALID_TOKEN', message: 'Export token invalid or expired' });
		}
		tokenToConsume = exportToken;
	}
	if (!userId) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}
	return { mode: 'build', userId, tokenToConsume };
}

/**
 * GET /api/identity/export-bundle-data
 *
 * Returns manifest, identity, posts, and assets (no key) for client-side export.
 * Auth: session (locals.user) or one-time export_token query param (from Syner verification).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const exportToken = url.searchParams.get('export_token');
	const resolved = await resolveExport(locals, exportToken);

	try {
		if (resolved.mode === 'signed') {
			const consumed = await consumeExportSignedBundle(resolved.tokenToConsume);
			if (!consumed) {
				return json(
					{
						status: 'error',
						error: { code: 'TOKEN_ALREADY_USED', message: 'Export token was already used' }
					},
					{ status: 409 }
				);
			}
			return json({
				status: 'success',
				data: {
					manifest: consumed.manifest,
					identity: consumed.identity,
					posts: consumed.posts,
					assets: consumed.assets,
					pinned_posts: consumed.pinned_posts
				},
				meta: { timestamp: new Date().toISOString() }
			});
		}
		if (resolved.tokenToConsume) {
			const consumed = await consumeExportToken(resolved.tokenToConsume);
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
		const result = await buildIdentityExport(resolved.userId);
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
	const resolved = await resolveExport(locals, exportToken);

	try {
		if (resolved.mode === 'signed') {
			const consumed = await consumeExportSignedBundle(resolved.tokenToConsume);
			if (!consumed) {
				return json(
					{
						status: 'error',
						error: { code: 'TOKEN_ALREADY_USED', message: 'Export token was already used' }
					},
					{ status: 409 }
				);
			}
			return json({
				status: 'success',
				data: {
					manifest: consumed.manifest,
					identity: consumed.identity,
					posts: consumed.posts,
					assets: consumed.assets,
					pinned_posts: consumed.pinned_posts
				},
				meta: { timestamp: new Date().toISOString() }
			});
		}
		if (resolved.tokenToConsume) {
			const consumed = await consumeExportToken(resolved.tokenToConsume);
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
		const result = await buildIdentityExport(resolved.userId);
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
