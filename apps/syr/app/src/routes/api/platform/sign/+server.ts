import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { PlatformSignRequestSchema } from '@syr-is/types';
import { platformDelegationController } from '$lib/controllers/platform-delegation.controller';
import { identityRepository, delegatedKeyRepository } from '$lib/repositories/identity.repository';

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
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return json(
				{ error: 'invalid_request', error_description: 'Invalid JSON body' },
				{ status: 400 }
			);
		}
		const data = PlatformSignRequestSchema.parse(body);

		// Extract the delegate key record ID from the session (format: "platform:{recordId}")
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

		// Look up the exact delegation by record ID
		const dk = await delegatedKeyRepository.findById(platformKeyRef);
		if (!dk) {
			return json(
				{ error: 'invalid_request', error_description: 'Platform delegation not found' },
				{ status: 400 }
			);
		}

		// Verify delegation belongs to this user
		const identity = await identityRepository.findByUserId(locals.user.id);
		if (!identity || dk.did !== identity.did) {
			return json(
				{ error: 'forbidden', error_description: 'Delegation does not belong to this user' },
				{ status: 403 }
			);
		}
		if (dk.revoked_at) {
			return json(
				{ error: 'delegation_revoked', error_description: 'Platform delegation has been revoked' },
				{ status: 403 }
			);
		}
		if (dk.expires_at && dk.expires_at < new Date()) {
			return json(
				{ error: 'delegation_expired', error_description: 'Platform delegation has expired' },
				{ status: 403 }
			);
		}

		const result = await platformDelegationController.signContent(
			identity.did,
			dk.platform_origin!,
			data.payload
		);

		return json(result);
	} catch (err) {
		if (err instanceof z.ZodError) {
			return json(
				{
					error: 'invalid_request',
					error_description: 'Invalid sign request',
					details: z.treeifyError(err)
				},
				{ status: 400 }
			);
		}
		console.error('Platform sign error:', err);
		return json(
			{ error: 'server_error', error_description: 'An unexpected server error occurred' },
			{ status: 500 }
		);
	}
};
