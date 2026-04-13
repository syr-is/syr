import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { PlatformChallengeRequestSchema } from '@syr-is/types';
import { platformDelegationController } from '$lib/controllers/platform-delegation.controller';
import { delegatedKeyRepository } from '$lib/repositories/identity.repository';

/**
 * POST /api/platform/challenge
 *
 * Re-login challenge endpoint.
 * A consumer application sends a random challenge; the instance signs it
 * with the platform's delegate key, proving the delegation is still active.
 * Requires a valid platform access token (Bearer).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json(
			{ error: 'unauthorized', error_description: 'Valid platform token required' },
			{ status: 401 }
		);
	}

	try {
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return json(
				{ error: 'invalid_request', error_description: 'Invalid JSON body' },
				{ status: 400 }
			);
		}
		const data = PlatformChallengeRequestSchema.parse(body);

		// Require a platform session — regular user sessions cannot use this endpoint
		const sessionId = locals.user.sessionId || '';
		const platformKeyRef = sessionId.startsWith('platform:')
			? sessionId.slice('platform:'.length)
			: null;

		if (!platformKeyRef) {
			return json(
				{ error: 'invalid_request', error_description: 'Not a platform session' },
				{ status: 400 }
			);
		}

		// Verify the session's delegation matches the requested did + platform_origin
		const dk = await delegatedKeyRepository.findById(platformKeyRef);
		if (!dk) {
			return json(
				{ error: 'invalid_request', error_description: 'Platform delegation not found' },
				{ status: 400 }
			);
		}
		if (dk.did !== data.did || dk.platform_origin !== data.platform_origin) {
			return json(
				{ error: 'forbidden', error_description: 'Challenge does not match session delegation' },
				{ status: 403 }
			);
		}

		const result = await platformDelegationController.signChallenge(
			data.did,
			data.platform_origin,
			data.challenge
		);

		return json(result);
	} catch (err) {
		if (err instanceof z.ZodError) {
			return json(
				{
					error: 'invalid_request',
					error_description: 'Invalid challenge request',
					details: z.treeifyError(err)
				},
				{ status: 400 }
			);
		}
		const message = err instanceof Error ? err.message : 'An unexpected error occurred';
		const is403 =
			message.includes('revoked') ||
			message.includes('not found') ||
			message.includes('expired') ||
			message.includes('missing encrypted key');
		return json(
			{ error: 'challenge_failed', error_description: message },
			{ status: is403 ? 403 : 500 }
		);
	}
};
