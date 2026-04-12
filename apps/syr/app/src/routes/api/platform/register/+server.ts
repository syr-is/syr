import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityRepository } from '$lib/repositories/identity.repository';
import { userRepository } from '$lib/repositories/user.repository';
import { PlatformRegistrationRequestSchema } from '@syr-is/types';
import { platformDelegation, config } from '$lib/config';
import { setPendingDelegation } from '$lib/server/platform-delegation-store';

/**
 * POST /api/platform/register
 *
 * A consumer application calls this endpoint to initiate platform delegation.
 * The instance looks up the DID, verifies it belongs to a local user,
 * and returns a challenge with a consent URL.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const data = PlatformRegistrationRequestSchema.parse(body);

		const identity = await identityRepository.findByDid(data.did);
		if (!identity) {
			return json(
				{
					error: 'unknown_did',
					error_description: 'No identity found for this DID on this instance'
				},
				{ status: 404 }
			);
		}

		const user = await userRepository.findById(identity.user_id);
		if (!user) {
			return json(
				{
					error: 'unknown_did',
					error_description: 'User associated with this DID no longer exists'
				},
				{ status: 404 }
			);
		}

		const challengeId = crypto.randomUUID();

		await setPendingDelegation(challengeId, {
			did: data.did,
			platform_origin: data.platform_origin,
			platform_name: data.platform_name,
			callback_url: data.callback_url,
			scopes: data.scopes,
			state: data.state,
			user_id: user.id.toString(),
			created_at: Date.now()
		});

		const consentUrl = `${config.PUBLIC_URL}/auth/platform-consent?challenge=${challengeId}`;

		return json({
			challenge_id: challengeId,
			consent_url: consentUrl,
			expires_in: platformDelegation.registrationExpiresIn
		});
	} catch (err) {
		if (err instanceof Error && err.name === 'ZodError') {
			return json(
				{ error: 'invalid_request', error_description: 'Invalid registration request' },
				{ status: 400 }
			);
		}
		console.error('Platform registration error:', err);
		return json(
			{ error: 'server_error', error_description: 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
