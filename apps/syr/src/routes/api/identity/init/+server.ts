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
	try {
		// Require authentication
		if (!locals.user) {
			throw error(401, {
				code: 'AUTHENTICATION_ERROR',
				message: 'Authentication required'
			});
		}

		const body = await request.json();

		// Validate request body
		const validatedData = IdentityInitRequestSchema.parse(body);

		// Initialize identity
		const result = await identityController.initializeIdentity(
			locals.user.id,
			validatedData
		);

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
				err.message.includes('does not match')
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
