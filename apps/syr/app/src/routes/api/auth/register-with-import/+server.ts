import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { UserSchema } from '@syr-is/types';
import { AegisBundleSchema } from '@syr-is/types';
import { hashPassword } from '$lib/server/auth';
import { generateAccessToken } from '$lib/server/auth';
import { config } from '$lib/config';
import { userRepository } from '$lib/repositories/user.repository';
import { sessionRepository } from '$lib/repositories/session.repository';
import { consumePublicImportToken } from '$lib/server/export-verify-store';
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

const UsernameSchema = UserSchema.shape.username;
const DisplayNameSchema = z.string().min(1).max(100);
const PasswordSchema = z
	.string()
	.min(8)
	.regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
	.regex(/[a-z]/, 'Password must contain at least one lowercase letter')
	.regex(/[0-9]/, 'Password must contain at least one number');

/**
 * POST /api/auth/register-with-import
 *
 * Creates user account and imports identity from bundle in one step. No auth required.
 * For migration flow when user has no account.
 *
 * Body: multipart/form-data with username, display_name, password, bundle (file),
 * and EITHER aegisBundle (JSON) OR import_token (for data-only .syr).
 */
export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const formData = await request.formData();
	const username = formData.get('username');
	const display_name = formData.get('display_name');
	const password = formData.get('password');
	const file = formData.get('bundle');
	const aegisBundleRaw = formData.get('aegisBundle');
	const importToken = formData.get('import_token');

	if (
		typeof username !== 'string' ||
		typeof password !== 'string' ||
		!file ||
		!(file instanceof File)
	) {
		throw error(400, {
			code: 'INVALID_REQUEST',
			message: 'Missing username, password, or bundle file'
		});
	}

	const displayName =
		typeof display_name === 'string' && display_name.trim() ? display_name.trim() : username;

	// Validate registration fields
	try {
		UsernameSchema.parse(username);
		DisplayNameSchema.parse(displayName);
		PasswordSchema.parse(password);
	} catch (e) {
		if (e instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: e.issues?.[0]?.message ?? 'Invalid input'
			});
		}
		throw e;
	}

	if (await userRepository.usernameExists(username)) {
		throw error(409, {
			code: 'CONFLICT',
			message: 'Username already exists'
		});
	}

	const useDataOnlyImport = typeof importToken === 'string' && importToken.length > 0;
	const parsed = await parseBundle(file);

	let did: string;
	let aegisBundle: z.infer<typeof AegisBundleSchema> | null = null;

	if (useDataOnlyImport) {
		const tokenData = await consumePublicImportToken(importToken);
		if (!tokenData) {
			throw error(403, {
				code: 'INVALID_TOKEN',
				message: 'Import token invalid or expired'
			});
		}
		did = await validateBundleForDataOnlyImport(parsed);
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
					'Missing aegisBundle. For full backup, decrypt Sigil and create Aegis. For data-only, verify with Syner and provide import_token.'
			});
		}
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
		did = await validateBundle(parsed, aegisBundle);
	}

	// Create user (no profile, no identity - import will create those)
	const password_hash = await hashPassword(password);
	const now = new Date();
	const user = await userRepository.create({
		username,
		password_hash,
		role: 'USER',
		created_at: now,
		updated_at: now
	} as Parameters<typeof userRepository.create>[0]);

	const userId = user.id.toString();

	// Create session
	const tokenBytes = new Uint8Array(32);
	crypto.getRandomValues(tokenBytes);
	const sessionToken = Array.from(tokenBytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + 7);
	const ip = getClientAddress?.() || undefined;
	const userAgent = request.headers.get('user-agent') || undefined;

	const session = await sessionRepository.create({
		user_id: user.id,
		token: sessionToken,
		expires_at: expiresAt,
		created_at: now,
		ip,
		user_agent: userAgent
	} as Parameters<typeof sessionRepository.create>[0]);

	// Run import
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
		if (useDataOnlyImport) {
			await importIdentityAndProfileExternal(ctx, parsed);
		} else if (aegisBundle) {
			await importIdentityAndProfile(ctx, parsed, aegisBundle);
		} else {
			throw new Error('Missing aegisBundle for full import');
		}

		const signingOpts = useDataOnlyImport
			? { verifySignatures: false }
			: { verifySignatures: true };
		const { postsImported, assetsImported, importedZipPaths } = await importPostsAndAssets(
			ctx,
			parsed,
			signingOpts
		);
		const standaloneAssetsImported = await importStandaloneAssets(
			ctx,
			parsed,
			importedZipPaths,
			signingOpts
		);
		await restorePinnedPosts(ctx, parsed);

		const accessToken = generateAccessToken({
			userId,
			sessionId: session.id.toString()
		});

		cookies.set('session', accessToken, {
			path: '/',
			httpOnly: true,
			secure: config.NODE_ENV === 'production',
			sameSite: 'strict',
			maxAge: 60 * 60 * 24 * 7
		});

		return json({
			status: 'success',
			data: {
				redirect: '/',
				did,
				postsImported,
				assetsImported: assetsImported + standaloneAssetsImported
			}
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		console.error('Register-with-import error:', err);
		await rollbackImport(ctx);
		try {
			await userRepository.delete(user.id);
		} catch (e) {
			console.error('Rollback: failed to delete user', e);
		}
		throw error(500, {
			code: 'IMPORT_FAILED',
			message: 'Identity import failed after user creation. Your account was not created.'
		});
	}
};
