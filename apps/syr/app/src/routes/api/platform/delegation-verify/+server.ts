import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verify, decodeMultibase } from '@syr-is/crypto';
import { parseDid } from '@syr-is/did';
import { kvService } from '$lib/services/kv';
import { getPendingDelegation, setPendingDelegation } from '$lib/server/platform-delegation-store';
import { identityRepository } from '$lib/repositories/identity.repository';
import { platformDelegationController } from '$lib/controllers/platform-delegation.controller';
import { notifyDelegationSigned } from '$lib/server/platform-delegation-broadcast';
interface StoredDelegationChallenge {
	message: string;
	delegation_id: string;
	user_id: string;
	created_at: number;
}

const KV_TYPE = 'platform_delegation_sign';

/**
 * POST /api/platform/delegation-verify
 *
 * Syner posts signed delegation here. This endpoint does EVERYTHING:
 * 1. Verify signature against DID pubkey
 * 2. Look up identity (must exist on instance)
 * 3. Create platform delegation using the signature
 * 4. Set authorization code on pending registration
 * 5. Notify SSE → consent page auto-redirects to callback
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { challenge_id, did, signature } = body;

		if (!challenge_id || !did || !signature) {
			return json(
				{
					error: 'invalid_request',
					error_description: 'challenge_id, did, and signature are required'
				},
				{ status: 400 }
			);
		}

		// Retrieve and consume challenge
		const challenge = await kvService.getAndDelete<StoredDelegationChallenge>(
			KV_TYPE,
			challenge_id
		);
		if (!challenge) {
			return json(
				{ error: 'challenge_expired', error_description: 'Challenge not found or expired' },
				{ status: 410 }
			);
		}

		// Verify signature against DID pubkey
		const parsed = parseDid(did);
		const signatureBytes = decodeMultibase(signature);
		const isValid = await verify(challenge.message, signatureBytes, parsed.publicKey);
		if (!isValid) {
			return json(
				{ error: 'invalid_signature', error_description: 'Signature verification failed' },
				{ status: 403 }
			);
		}

		// Look up identity on this instance
		const identity = await identityRepository.findByDid(did);
		if (!identity) {
			return json(
				{
					error: 'unknown_did',
					error_description: 'Identity not found on this instance'
				},
				{ status: 404 }
			);
		}

		// Get pending registration
		const registration = await getPendingDelegation(challenge.delegation_id);
		if (!registration) {
			return json(
				{
					error: 'registration_expired',
					error_description: 'Platform registration expired'
				},
				{ status: 410 }
			);
		}

		// Create platform delegation using Syner's signature as root sig
		const rootSignFn = async () => signatureBytes;

		try {
			await platformDelegationController.createPlatformDelegation({
				userId: identity.user_id,
				did,
				platformOrigin: registration.platform_origin,
				platformName: registration.platform_name,
				rootSignFn
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Delegation creation failed';
			return json({ error: 'delegation_failed', error_description: msg }, { status: 500 });
		}

		// Set authorization code on registration
		const code = crypto.randomUUID();
		registration.did = did;
		registration.code = code;
		await setPendingDelegation(challenge.delegation_id, registration);

		// Build callback URL
		const callbackUrl = new URL(registration.callback_url);
		callbackUrl.searchParams.set('code', code);
		if (registration.state) {
			callbackUrl.searchParams.set('state', registration.state);
		}

		// Notify SSE → consent page auto-redirects
		notifyDelegationSigned(challenge_id, {
			signature,
			did,
			redirect_url: callbackUrl.toString()
		});

		return json({ success: true });
	} catch (err) {
		console.error('Delegation verify error:', err);
		return json(
			{ error: 'server_error', error_description: 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
