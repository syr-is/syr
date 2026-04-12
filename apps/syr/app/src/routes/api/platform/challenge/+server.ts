import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PlatformChallengeRequestSchema } from '@syr-is/types';
import { platformDelegationController } from '$lib/controllers/platform-delegation.controller';

/**
 * POST /api/platform/challenge
 *
 * Re-login challenge endpoint.
 * A consumer application sends a random challenge; the instance signs it
 * with the platform's delegate key, proving the delegation is still active.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const data = PlatformChallengeRequestSchema.parse(body);

		const result = await platformDelegationController.signChallenge(
			data.did,
			data.platform_origin,
			data.challenge
		);

		return json(result);
	} catch (err) {
		if (err instanceof Error && err.name === 'ZodError') {
			return json(
				{ error: 'invalid_request', error_description: 'Invalid challenge request' },
				{ status: 400 }
			);
		}
		const message = err instanceof Error ? err.message : 'An unexpected error occurred';
		const status = message.includes('revoked') || message.includes('not found') ? 403 : 500;
		return json({ error: 'challenge_failed', error_description: message }, { status });
	}
};
