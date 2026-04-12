import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { platformDelegationController } from '$lib/controllers/platform-delegation.controller';

/**
 * POST /api/platform/revoke
 *
 * Revoke a platform delegation. Requires authenticated user session.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json(
			{ error: 'unauthorized', error_description: 'Authentication required' },
			{ status: 401 }
		);
	}

	try {
		const body = await request.json();
		const { platform_origin } = body;

		if (!platform_origin || typeof platform_origin !== 'string') {
			return json(
				{
					error: 'invalid_request',
					error_description: 'platform_origin is required'
				},
				{ status: 400 }
			);
		}

		await platformDelegationController.revokeDelegation(locals.user.id, platform_origin);

		return json({ status: 'revoked' });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'An unexpected error occurred';
		const status = message.includes('not found') ? 404 : 500;
		return json({ error: 'revocation_failed', error_description: message }, { status });
	}
};
