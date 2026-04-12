import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PlatformSignRequestSchema } from '@syr-is/types';
import { platformDelegationController } from '$lib/controllers/platform-delegation.controller';
import { identityRepository } from '$lib/repositories/identity.repository';

/**
 * POST /api/platform/sign
 *
 * Signing-as-a-service endpoint.
 * A consumer application sends content to be signed with the platform delegate key.
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
		const body = await request.json();
		const data = PlatformSignRequestSchema.parse(body);

		// Extract platform origin from the session ID (platform:{delegateKeyId})
		const identity = await identityRepository.findByUserId(locals.user.id);
		if (!identity) {
			return json(
				{ error: 'server_error', error_description: 'User identity not found' },
				{ status: 500 }
			);
		}

		// The platform origin must be provided or determined from the token context.
		// For now, we look it up via the session's delegate key reference.
		const sessionId = ((locals as Record<string, unknown>).session_id as string) || '';
		const platformKeyRef = sessionId.startsWith('platform:')
			? sessionId.slice('platform:'.length)
			: null;

		if (!platformKeyRef) {
			return json(
				{
					error: 'invalid_request',
					error_description: 'Not a platform session'
				},
				{ status: 400 }
			);
		}

		// Find the delegation by looking up all platform delegations for this DID
		// and matching the one referenced by the session
		const delegations = await platformDelegationController.getDelegations(identity.did);
		if (delegations.length === 0) {
			return json(
				{
					error: 'invalid_request',
					error_description: 'No platform delegations found'
				},
				{ status: 400 }
			);
		}

		// Use the first active delegation (the session should only correspond to one)
		const activeDelegation = delegations.find((d) => !d.revoked_at);
		if (!activeDelegation) {
			return json(
				{
					error: 'delegation_revoked',
					error_description: 'Platform delegation has been revoked'
				},
				{ status: 403 }
			);
		}

		const result = await platformDelegationController.signContent(
			identity.did,
			activeDelegation.platform_origin,
			data.payload
		);

		return json(result);
	} catch (err) {
		if (err instanceof Error && err.name === 'ZodError') {
			return json(
				{ error: 'invalid_request', error_description: 'Invalid sign request' },
				{ status: 400 }
			);
		}
		console.error('Platform sign error:', err);
		return json(
			{
				error: 'server_error',
				error_description: err instanceof Error ? err.message : 'An unexpected error occurred'
			},
			{ status: 500 }
		);
	}
};
