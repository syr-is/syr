import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { IdentityDelegateRequestSchema } from '@syr-is/types';
import { identityController } from '$lib/controllers/identity.controller';
import { z } from 'zod';

/**
 * POST /api/identity/delegate
 *
 * Add a new device key to an existing identity.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'Authentication required'
		});
	}

	try {
		const body = await request.json();
		const validatedData = IdentityDelegateRequestSchema.parse(body);

		const result = await identityController.delegateIdentity(locals.user.id, validatedData);

		return json(
			{
				status: 'success',
				data: result,
				meta: { timestamp: new Date().toISOString() }
			},
			{ status: 201 }
		);
	} catch (err) {
		if (
			err &&
			typeof err === 'object' &&
			'status' in err &&
			typeof (err as { status: number }).status === 'number'
		) {
			throw err;
		}
		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid delegate request',
				details: z.treeifyError(err)
			});
		}
		if (err instanceof Error) {
			if (
				err.message.includes('not found') ||
				err.message.includes('not belong') ||
				err.message.includes('Invalid delegation') ||
				err.message.includes('does not match') ||
				err.message.includes('does not authorize') ||
				err.message.includes('already delegated')
			) {
				throw error(400, {
					code: 'VALIDATION_ERROR',
					message: err.message
				});
			}
		}
		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Delegate failed'
		});
	}
};
