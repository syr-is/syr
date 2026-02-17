import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityController } from '$lib/controllers/identity.controller';
import { z } from 'zod';

const RevokeBodySchema = z.object({
	devicePublicKey: z.string().min(1, 'devicePublicKey is required')
});

/**
 * POST /api/identity/delegate/revoke
 *
 * Revoke a delegated device key.
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
		const { devicePublicKey } = RevokeBodySchema.parse(body);

		await identityController.revokeDelegatedKey(locals.user.id, devicePublicKey);

		return json({
			status: 'success',
			meta: { timestamp: new Date().toISOString() }
		});
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
				message: 'Invalid request body',
				details: z.treeifyError(err)
			});
		}
		if (err instanceof Error) {
			if (
				err.message.includes('not found') ||
				err.message.includes('not belong') ||
				err.message.includes('already revoked') ||
				err.message.includes('only active')
			) {
				throw error(400, {
					code: 'VALIDATION_ERROR',
					message: err.message
				});
			}
		}
		throw error(500, {
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Revoke failed'
		});
	}
};
