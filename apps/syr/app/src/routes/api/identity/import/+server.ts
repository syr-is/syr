import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { AegisBundleSchema } from '@syr-is/types';
import { identityRepository } from '$lib/repositories/identity.repository';
import { z } from 'zod';
import { consumeImportToken } from '$lib/server/export-verify-store';
import {
	parseBundle,
	validateBundle,
	validateBundleForDataOnlyImport,
	importIdentityAndProfile,
	importIdentityAndProfileExternal,
	importPostsAndAssets,
	importStandaloneAssets,
	restorePinnedPosts,
	rollbackImport,
	type ImportContext
} from '$lib/services/identity-import.service';

/**
 * POST /api/identity/import
 *
 * Import identity bundle from a zip file.
 * Auth: session required. Either aegisBundle (full backup with Sigil) or import_token (data-only, from Syner verify).
 *
 * Expects: multipart/form-data with "bundle" file, and EITHER "aegisBundle" OR "import_token".
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
	const aegisBundleRaw = formData.get('aegisBundle');
	const importToken = formData.get('import_token');

	if (!file || !(file instanceof File)) {
		throw error(400, {
			code: 'INVALID_REQUEST',
			message: 'Missing "bundle" file in form data'
		});
	}

	const useDataOnlyImport = typeof importToken === 'string' && importToken.length > 0;

	let did: string;

	if (useDataOnlyImport) {
		const tokenData = await consumeImportToken(importToken);
		if (!tokenData) {
			throw error(403, {
				code: 'INVALID_TOKEN',
				message: 'Import token invalid or expired'
			});
		}
		if (tokenData.user_id !== userId) {
			throw error(403, {
				code: 'TOKEN_USER_MISMATCH',
				message: 'Import token does not match current user'
			});
		}
		const parsed = await parseBundle(file);
		did = await validateBundleForDataOnlyImport(parsed);
		if (parsed.identity.did !== tokenData.did) {
			throw error(400, {
				code: 'DID_MISMATCH',
				message: 'Bundle DID does not match verified identity'
			});
		}

		const ctx: ImportContext = {
			did,
			userId,
			createdProfile: null,
			createdPostIds: [],
			createdUploadIds: [],
			uploadedS3Keys: [],
			pinnedPostsRestored: false
		};

		try {
			await importIdentityAndProfileExternal(ctx, parsed);
			const { postsImported, assetsImported, importedZipPaths } = await importPostsAndAssets(
				ctx,
				parsed
			);
			const standaloneAssetsImported = await importStandaloneAssets(ctx, parsed, importedZipPaths);
			const pinnedRestored = await restorePinnedPosts(ctx, parsed);
			return json({
				status: 'success',
				data: {
					did,
					postsImported,
					assetsImported: assetsImported + standaloneAssetsImported,
					pinnedRestored
				}
			});
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err) {
				throw err;
			}
			console.error('Identity import error:', err);
			await rollbackImport(ctx);
			throw error(500, {
				code: 'IMPORT_FAILED',
				message: 'Identity import failed. The operation may have partially completed.'
			});
		}
	}

	// Full import with Aegis
	if (!aegisBundleRaw || typeof aegisBundleRaw !== 'string') {
		throw error(400, {
			code: 'INVALID_REQUEST',
			message:
				'Missing "aegisBundle" in form data. For full backup import, decrypt the Sigil and create Aegis with your new password. For data-only backup, use "Verify with Syner" and provide import_token.'
		});
	}

	let aegisBundle: z.infer<typeof AegisBundleSchema>;
	try {
		const parsed = JSON.parse(aegisBundleRaw);
		aegisBundle = AegisBundleSchema.parse(parsed);
	} catch (err) {
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'INVALID_AEGIS',
				message: 'Invalid aegisBundle structure',
				details: z.treeifyError(err)
			});
		}
		throw error(400, {
			code: 'INVALID_AEGIS',
			message: 'Invalid aegisBundle JSON'
		});
	}

	const parsed = await parseBundle(file);
	did = await validateBundle(parsed, aegisBundle);

	const ctx: ImportContext = {
		did,
		userId,
		createdProfile: null,
		createdPostIds: [],
		createdUploadIds: [],
		uploadedS3Keys: [],
		pinnedPostsRestored: false
	};

	try {
		await importIdentityAndProfile(ctx, parsed, aegisBundle);

		const { postsImported, assetsImported, importedZipPaths } = await importPostsAndAssets(
			ctx,
			parsed
		);

		const standaloneAssetsImported = await importStandaloneAssets(ctx, parsed, importedZipPaths);

		const pinnedRestored = await restorePinnedPosts(ctx, parsed);

		return json({
			status: 'success',
			data: {
				did,
				postsImported,
				assetsImported: assetsImported + standaloneAssetsImported,
				pinnedRestored
			}
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		console.error('Identity import error:', err);
		await rollbackImport(ctx);
		throw error(500, {
			code: 'IMPORT_FAILED',
			message: 'Identity import failed. The operation may have partially completed.'
		});
	}
};
