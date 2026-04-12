import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consumePendingDelegation } from '$lib/server/platform-delegation-store';
import { delegatedKeyRepository } from '$lib/repositories/identity.repository';
import { generateAccessToken } from '$lib/server/auth';
import { platformDelegation } from '$lib/config';

/**
 * POST /api/platform/token
 *
 * Exchange an authorization code for a platform access token.
 * Uses direct delegation_id lookup (not code search) for reliability.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { code, delegation_id, callback_url, platform_origin } = body;

		if (!code || !delegation_id) {
			return json(
				{ error: 'invalid_request', error_description: 'code and delegation_id are required' },
				{ status: 400 }
			);
		}

		// Always require origin and callback
		if (!platform_origin || !callback_url) {
			return json(
				{
					error: 'invalid_request',
					error_description: 'platform_origin and callback_url are required'
				},
				{ status: 400 }
			);
		}

		// Atomically consume: validates code + origin + callback before deleting
		const registration = await consumePendingDelegation(delegation_id, code, {
			platform_origin,
			callback_url
		});
		if (!registration) {
			return json(
				{
					error: 'invalid_code',
					error_description: 'Registration not found, expired, or code/origin/callback mismatch'
				},
				{ status: 400 }
			);
		}

		// Look up the platform delegation to get the delegate public key
		const dk = await delegatedKeyRepository.findByDidAndPlatformOrigin(
			registration.did,
			registration.platform_origin
		);
		if (!dk) {
			// Debug: try finding any delegated keys for this DID
			const allKeys = await delegatedKeyRepository.findByDid(registration.did);
			console.error(
				'[platform/token] No platform delegation found. All keys for DID:',
				allKeys.map((k) => ({ scope: k.scope, origin: k.platform_origin, revoked: !!k.revoked_at }))
			);
			return json(
				{
					error: 'server_error',
					error_description: 'Platform delegation not found after consent'
				},
				{ status: 500 }
			);
		}

		// Generate platform access token
		const accessToken = generateAccessToken({
			userId: registration.user_id,
			sessionId: `platform:${dk.id.toString()}`
		});

		return json({
			access_token: accessToken,
			token_type: 'Bearer' as const,
			expires_in: platformDelegation.tokenExpiresIn,
			did: registration.did,
			delegate_public_key: dk.public_key,
			scopes: registration.scopes
		});
	} catch (err) {
		console.error('Platform token exchange error:', err);
		return json(
			{ error: 'server_error', error_description: 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
