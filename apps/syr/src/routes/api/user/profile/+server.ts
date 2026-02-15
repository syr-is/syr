import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { userController } from '$lib/controllers/user.controller';
import { identityController } from '$lib/controllers/identity.controller';
import { ProfileUpdateSchema, SignedMutationSchema } from '@syr-is/types';
import { z } from 'zod';

/**
 * PATCH /api/user/profile
 *
 * Update the user's profile. Supports two modes:
 *
 * 1. **Signed mutation** (if user has identity): Request body is a SignedMutation
 *    with { payload, signature, devicePublicKey }. The server verifies the
 *    delegation chain and payload signature before applying the mutation.
 *
 * 2. **Unsigned mutation** (backward compat, if user has no identity): Request body
 *    is a plain ProfileUpdate object. Standard auth-gated write.
 */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	// Check authentication
	if (!locals.user) {
		throw error(401, {
			code: 'UNAUTHORIZED',
			message: 'You must be logged in to update your profile'
		});
	}

	try {
		const body = await request.json();

		// Check if this is a signed mutation
		const signedResult = SignedMutationSchema.safeParse(body);

		if (signedResult.success) {
			// Signed mutation path: verify delegation chain + signature
			const { payload, signature, devicePublicKey } = signedResult.data;

			// Verify the full delegation chain and payload signature
			await identityController.verifySignedMutation(payload, signature, devicePublicKey);

			// Validate the payload as a profile update
			const data = ProfileUpdateSchema.parse(payload);

			// Apply the mutation
			const result = await userController.updateProfile(locals.user.id, data);

			return json({
				status: 'success',
				data: result
			});
		}

		// Unsigned mutation path: only allowed if user has no identity
		const hasIdentity = await identityController.hasIdentity(locals.user.id);
		if (hasIdentity) {
			throw error(400, {
				code: 'SIGNATURE_REQUIRED',
				message:
					'Profile mutations must be signed with a delegated device key. ' +
					'Your identity requires cryptographic signatures for all mutations.'
			});
		}

		// Parse and validate request body (unsigned, backward-compatible)
		const data = ProfileUpdateSchema.parse(body);

		// Update profile
		const result = await userController.updateProfile(locals.user.id, data);

		return json({
			status: 'success',
			data: result
		});
	} catch (err) {
		// Rethrow SvelteKit error() / redirect() — they don't extend Error
		if (
			err &&
			typeof err === 'object' &&
			'status' in err &&
			typeof (err as { status: number }).status === 'number'
		) {
			throw err;
		}
		console.error('Profile update error:', err);

		// Handle Zod validation errors
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid profile data',
				details: z.treeifyError(err)
			});
		}

		if (err instanceof Error) {
			if (err.message === 'Profile not found') {
				throw error(404, {
					code: 'NOT_FOUND',
					message: 'Profile not found'
				});
			}

			if (
				err.message.includes('Device key') ||
				err.message.includes('delegation') ||
				err.message.includes('signature') ||
				err.message.includes('Identity not found')
			) {
				throw error(403, {
					code: 'FORBIDDEN',
					message: err.message
				});
			}
		}

		throw error(500, {
			code: 'INTERNAL_ERROR',
			message: 'An unexpected error occurred'
		});
	}
};
