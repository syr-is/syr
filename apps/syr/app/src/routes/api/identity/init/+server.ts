import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { IdentityInitRequestSchema } from '@syr-is/types';
import { identityController } from '$lib/controllers/identity.controller';
import { z } from 'zod';

/**
 * POST /api/identity/init
 *
 * Initialize a new cryptographic identity for the authenticated user.
 * Called by the client after generating root and device keypairs.
 *
 * Request body: IdentityInitRequest
 * - did: The did:syr identifier
 * - publicKey: Multibase-encoded root public key
 * - devicePublicKey: Multibase-encoded device public key
 * - delegation: Signed delegation statement
 *
 * Requires: Authenticated session
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	// Require authentication (outside try so 401 is not swallowed by catch)
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'Authentication required'
		});
	}

	try {
		const body = await request.json();

		// Validate request body
		const validatedData = IdentityInitRequestSchema.parse(body);

		// Initialize identity
		const result = await identityController.initializeIdentity(locals.user.id, validatedData);

		return json(
			{
				status: 'success',
				data: result,
				meta: {
					timestamp: new Date().toISOString()
				}
			},
			{ status: 201 }
		);
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
		// JSON parse errors from request.json()
		if (
			err instanceof SyntaxError ||
			(err && typeof err === 'object' && (err as Error).name === 'SyntaxError') ||
			(err instanceof Error && /JSON|Unexpected token/i.test(err.message))
		) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Malformed JSON body'
			});
		}
		console.error('Identity init error:', err);

		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid identity data',
				details: z.treeifyError(err)
			});
		}

		if (err instanceof Error) {
			if (err.message.includes('already has an identity')) {
				throw error(409, {
					code: 'CONFLICT',
					message: err.message
				});
			}

			if (
				err.message.includes('Invalid delegation') ||
				err.message.includes('does not match') ||
				err.message.includes('does not authorize')
			) {
				throw error(400, {
					code: 'VALIDATION_ERROR',
					message: err.message
				});
			}
		}

		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Identity initialization failed'
		});
	}
};
