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
import { peekPublicImportToken, consumePublicImportToken } from '$lib/server/export-verify-store';
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
	ImportValidationError,
	type ImportContext
} from '$lib/services/identity-import.service';
import { profileRepository } from '$lib/repositories/profile.repository';

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
export const POST: RequestHandler = async ({ request, cookies, getClientAddress, locals }) => {
	if (locals.user) {
		throw error(403, {
			code: 'ALREADY_AUTHENTICATED',
			message: 'You are already signed in. Cannot create a second account.'
		});
	}

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
		const tokenData = await peekPublicImportToken(importToken);
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
		const consumed = await consumePublicImportToken(importToken);
		if (!consumed) {
			throw error(403, {
				code: 'INVALID_TOKEN',
				message: 'Import token invalid or already used'
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

	// Detect unsigned posts in full-import mode — suggest data-only flow
	if (!useDataOnlyImport && parsed.posts.length > 0 && !parsed.posts[0]?.signature) {
		throw error(400, {
			code: 'UNSIGNED_BACKUP',
			message:
				'This backup appears to be a data-only export (unsigned posts). Use "Verify with Syner" on the migrate page instead of entering a passphrase.'
		});
	}

	// Run import inside try so user/session are only created after validation
	const ctx: ImportContext = {
		did,
		userId: '', // Set after user creation
		createdProfile: null,
		createdPostIds: [],
		createdUploadIds: [],
		uploadedS3Keys: [],
		pinnedPostsRestored: false
	};

	// Data-only exports (from independent SYR) have unsigned posts — export-bundle-data returns
	// raw DB data. Trust is established via Syner verification (import_token). Skip signature
	// verification for data-only imports.
	const signingOpts = { verifySignatures: !useDataOnlyImport };

	try {
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

		ctx.userId = user.id.toString();

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
		if (useDataOnlyImport) {
			await importIdentityAndProfileExternal(ctx, parsed);
		} else if (aegisBundle) {
			await importIdentityAndProfile(ctx, parsed, aegisBundle);
		} else {
			throw new Error('Missing aegisBundle for full import');
		}
		// Override profile display name with form value when provided
		await profileRepository.mergeByUserId(ctx.userId, {
			display_name: displayName
		});

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
			userId: ctx.userId,
			sessionId: session.id.toString()
		});

		cookies.set('session', accessToken, {
			path: '/',
			httpOnly: true,
			secure: config.NODE_ENV === 'production',
			sameSite: 'lax',
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
		console.error('[register-with-import] Error:', err, {
			useDataOnlyImport,
			verifySignatures: signingOpts.verifySignatures
		});
		await rollbackImport(ctx);
		// Clean up user and session if they were created (ctx.userId set)
		if (ctx.userId) {
			try {
				await sessionRepository.deleteByUserId(ctx.userId);
			} catch (e) {
				console.error('Rollback: failed to delete session', e);
			}
			try {
				await userRepository.delete(ctx.userId);
			} catch (e) {
				console.error('Rollback: failed to delete user', e);
			}
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
		throw error(500, {
			code: 'IMPORT_FAILED',
			message: 'Identity import failed. Your account was not created.'
		});
	}
};
