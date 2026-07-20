import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { AegisBundleSchema } from '@syr-is/types';
import { stringToRecordId } from '@syr-is/types';
import { identityRepository } from '$lib/repositories/identity.repository';
import { consumeImportToken } from '$lib/server/export-verify-store';
import {
	parseBundle,
	assertBundleIntegrity,
	validateBundle,
	validateBundleForDataOnlyImport,
	syncPostsAndProfileFromBundle,
	rollbackImport,
	ImportValidationError,
	type ImportContext
} from '$lib/services/identity-import.service';

/**
 * POST /api/identity/sync-from-backup
 *
 * Sync posts and profile from a .syr or .persona backup into existing identity.
 * Auth required. Bundle DID must match current user's identity.
 *
 * Body: multipart/form-data with bundle (file), and EITHER aegisBundle OR import_token.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	const identity = await identityRepository.findByUserId(stringToRecordId.decode(locals.user.id));
	if (!identity) {
		throw error(400, {
			code: 'NO_IDENTITY',
			message: 'You must have an identity to sync. Use import instead.'
		});
	}

	const formData = await request.formData();
	const file = formData.get('bundle');
	const aegisBundleRaw = formData.get('aegisBundle');
	const importToken = formData.get('import_token');

	if (!file || !(file instanceof File)) {
		throw error(400, {
			code: 'INVALID_REQUEST',
			message: 'Missing bundle file'
		});
	}

	const useDataOnlyImport = typeof importToken === 'string' && importToken.length > 0;
	const parsed = await parseBundle(file);

	// Authenticity backstop: hard-fail a tampered v2 signed bundle before any writes
	// (or token consumption). Mirrors POST /api/identity/import. Legacy v1 and
	// explicitly-unsigned v2 bundles pass through; only a v2 SIGNED bundle that fails
	// a hash/chain/signature check is rejected (HTTP 422 IMPORT_TAMPERED).
	await assertBundleIntegrity(parsed);

	let did: string;

	if (useDataOnlyImport) {
		const tokenData = await consumeImportToken(importToken);
		if (!tokenData) {
			throw error(403, {
				code: 'INVALID_TOKEN',
				message: 'Import token invalid or expired'
			});
		}
		if (tokenData.user_id !== locals.user.id) {
			throw error(403, {
				code: 'TOKEN_USER_MISMATCH',
				message: 'Token does not match current user'
			});
		}
		did = await validateBundleForDataOnlyImport(parsed, { allowExistingDid: true });
		if (parsed.identity.did !== tokenData.did) {
			throw error(400, {
				code: 'DID_MISMATCH',
				message: 'Bundle DID does not match verified identity'
			});
		}
	} else {
		if (!aegisBundleRaw || typeof aegisBundleRaw !== 'string') {
			throw error(400, {
				code: 'INVALID_REQUEST',
				message:
					'Missing aegisBundle. For full backup, decrypt Sigil. For data-only, verify with Syner and provide import_token.'
			});
		}
		let aegisBundle: z.infer<typeof AegisBundleSchema>;
		try {
			aegisBundle = AegisBundleSchema.parse(JSON.parse(aegisBundleRaw));
		} catch (err) {
			if (err instanceof z.ZodError) {
				throw error(400, {
					code: 'INVALID_AEGIS',
					message: 'Invalid aegisBundle structure'
				});
			}
			throw error(400, { code: 'INVALID_AEGIS', message: 'Invalid aegisBundle JSON' });
		}
		did = await validateBundle(parsed, aegisBundle, { allowExistingDid: true });
	}

	if (did !== identity.did) {
		throw error(400, {
			code: 'DID_MISMATCH',
			message: 'This backup does not match your identity.'
		});
	}

	const ctx: ImportContext = {
		did,
		userId: locals.user.id,
		createdProfile: null,
		createdPostIds: [],
		createdUploadIds: [],
		uploadedS3Keys: [],
		pinnedPostsRestored: false
	};

	const signingOpts = { verifySignatures: !useDataOnlyImport };
	try {
		const result = await syncPostsAndProfileFromBundle(ctx, parsed, signingOpts);
		return json({
			status: 'success',
			data: {
				postsImported: result.postsImported,
				assetsImported: result.assetsImported,
				profileUpdated: result.profileUpdated
			}
		});
	} catch (err) {
		try {
			await rollbackImport(ctx);
		} catch (rollbackErr) {
			console.error('Sync from backup rollback failed:', rollbackErr);
		}
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		if (err instanceof ImportValidationError) {
			throw error(err.code === 'IMPORT_BAD_SIGNATURE' ? 422 : 400, {
				code: err.code,
				message: err.message
			});
		}
		console.error('Sync from backup error:', err);
		throw error(500, {
			code: 'SYNC_FAILED',
			message: 'Sync failed'
		});
	}
};
