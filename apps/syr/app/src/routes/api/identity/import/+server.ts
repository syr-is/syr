import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { AegisBundle } from '@syr-is/crypto/aegis';
import { identityRepository } from '$lib/repositories/identity.repository';
import {
	parseBundle,
	validateBundle,
	importIdentityAndProfile,
	importPostsAndAssets,
	importStandaloneAssets,
	restorePinnedPosts,
	rollbackImport,
	type ImportContext
} from '$lib/services/identity-import.service';

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
	const aegisBundleRaw = formData.get('aegisBundle');

	if (!file || !(file instanceof File)) {
		throw error(400, {
			code: 'INVALID_REQUEST',
			message: 'Missing "bundle" file in form data'
		});
	}

	if (!aegisBundleRaw || typeof aegisBundleRaw !== 'string') {
		throw error(400, {
			code: 'INVALID_REQUEST',
			message:
				'Missing "aegisBundle" in form data. The client must decrypt the Sigil and create Aegis with your new password before uploading.'
		});
	}

	let aegisBundle: AegisBundle;
	try {
		aegisBundle = JSON.parse(aegisBundleRaw) as AegisBundle;
		if (
			!aegisBundle.pub ||
			!aegisBundle.salt ||
			!aegisBundle.nonce ||
			!aegisBundle.ct ||
			!aegisBundle.tag ||
			!aegisBundle.kdf
		) {
			throw new Error('Invalid aegisBundle structure');
		}
	} catch {
		throw error(400, {
			code: 'INVALID_AEGIS',
			message: 'Invalid aegisBundle JSON'
		});
	}

	const parsed = await parseBundle(file);
	const did = await validateBundle(parsed, aegisBundle);

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
