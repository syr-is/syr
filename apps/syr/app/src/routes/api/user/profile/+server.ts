import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { userController } from '$lib/controllers/user.controller';
import { profileRepository } from '$lib/repositories/profile.repository';
import { ProfilePatchRequestSchema } from '@syr-is/types';
import { assertProfileSignedMutation } from '$lib/server/signed-mutation.server';
import { z } from 'zod';

/**
 * PATCH /api/user/profile
 *
 * Body validated by `ProfilePatchRequestSchema` (profile fields + optional `signed_mutation`).
 * When signing is required, `assertProfileSignedMutation` verifies the envelope; when it is not
 * required and no envelope is sent, stored verification columns are cleared.
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

		// Parse and validate request body
		const parsed = ProfilePatchRequestSchema.parse(body);
		const { signed_mutation, ...profileFields } = parsed;

		const { signature } = await assertProfileSignedMutation(
			locals.user.id,
			signed_mutation,
			profileFields
		);

		const mergePayload = signature ? { ...profileFields, ...signature } : profileFields;
		const result = await userController.updateProfile(locals.user.id, mergePayload);
		if (!signature) {
			await profileRepository.clearSigningFieldsByUserId(locals.user.id);
			const profile = await profileRepository.findByUserId(locals.user.id);
			return json({
				status: 'success',
				data: { profile: profile ?? result.profile }
			});
		}

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
		}

		throw error(500, {
			code: 'INTERNAL_ERROR',
			message: 'An unexpected error occurred'
		});
	}
};
