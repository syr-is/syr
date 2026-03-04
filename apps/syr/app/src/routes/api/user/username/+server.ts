import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { userController } from '$lib/controllers/user.controller';
import { UserSchema } from '@syr-is/types';
import { z } from 'zod';

const PatchBodySchema = z.object({
	username: UserSchema.shape.username
});

/**
 * PATCH /api/user/username
 *
 * Update the user's username. Requires authenticated session.
 * Subject to instance config cooldown (username_change_cooldown_days).
 */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'UNAUTHORIZED',
			message: 'You must be logged in to update your username'
		});
	}

	try {
		const body = await request.json();
		const { username } = PatchBodySchema.parse(body);

		const updated = await userController.updateUsername(locals.user.id, username);

		return json({
			status: 'success',
			data: { username: updated.username }
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
		console.error('Username update error:', err);

		if (err instanceof z.ZodError) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid username',
				details: z.treeifyError(err)
			});
		}

		const msg = err instanceof Error ? err.message : 'Failed to update username';
		if (msg.includes('already taken')) {
			throw error(409, { code: 'CONFLICT', message: msg });
		}
		if (msg.includes('change your username again')) {
			throw error(429, { code: 'COOLDOWN', message: msg });
		}
		if (msg === 'User not found') {
			throw error(404, { code: 'NOT_FOUND', message: msg });
		}

		throw error(500, { code: 'INTERNAL_ERROR', message: msg });
	}
};
