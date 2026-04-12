import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verify, decodeMultibase, encodeMultibase } from '@syr-is/crypto';
import { parseDid } from '@syr-is/did';
import {
	consumeDelegationChallenge,
	consumePendingKeypair,
	getPendingDelegation,
	setPendingDelegation
} from '$lib/server/platform-delegation-store';
import { identityRepository } from '$lib/repositories/identity.repository';
import { platformDelegationController } from '$lib/controllers/platform-delegation.controller';
import { notifyDelegationSigned } from '$lib/server/platform-delegation-broadcast';

/**
 * POST /api/platform/delegation-verify
 *
 * Round 2 of the two-round Syner delegation flow.
 * Syner posts the signed canonical delegation statement.
 * Server verifies, retrieves the pre-generated keypair, and stores the delegation.
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

		// Atomically consume challenge (prevents replay)
		const challenge = await consumeDelegationChallenge(challenge_id);
		if (!challenge) {
			return json(
				{ error: 'challenge_expired', error_description: 'Challenge not found or expired' },
				{ status: 410 }
			);
		}

		// Verify signature against DID root public key
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
				{ error: 'unknown_did', error_description: 'Identity not found on this instance' },
				{ status: 404 }
			);
		}

		// Validate user_id matches (prevent cross-user delegation)
		if (identity.user_id.toString() !== challenge.user_id) {
			return json(
				{ error: 'mismatched_did', error_description: 'Identity does not match registration' },
				{ status: 403 }
			);
		}

		// Consume pre-generated keypair (atomic — prevents double-use)
		const keypair = await consumePendingKeypair(challenge.delegation_id);
		if (!keypair) {
			return json(
				{
					error: 'keypair_expired',
					error_description: 'Pre-generated keypair not found or expired'
				},
				{ status: 410 }
			);
		}

		// Store the delegation with the REAL signature that attests to the actual delegate key
		const signatureMultibase = encodeMultibase(signatureBytes);
		try {
			await platformDelegationController.storePlatformDelegation({
				userId: identity.user_id,
				did,
				platformOrigin: keypair.platform_origin,
				platformName: keypair.platform_name,
				delegatePublicKeyMultibase: keypair.delegate_public_key_multibase,
				aegisDelegate: keypair.aegis_delegate as import('@syr-is/types').AegisBundle,
				signatureMultibase,
				canonicalDelegation: keypair.canonical_statement,
				createdAt: new Date(keypair.created_at)
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Delegation creation failed';
			return json({ error: 'delegation_failed', error_description: msg }, { status: 500 });
		}

		// Get pending registration to set auth code
		const registration = await getPendingDelegation(challenge.delegation_id);
		if (registration) {
			const code = crypto.randomUUID();
			registration.did = did;
			registration.code = code;
			await setPendingDelegation(challenge.delegation_id, registration);

			const callbackUrl = new URL(registration.callback_url);
			callbackUrl.searchParams.set('code', code);
			if (registration.state) {
				callbackUrl.searchParams.set('state', registration.state);
			}

			notifyDelegationSigned(challenge_id, {
				signature,
				did,
				redirect_url: callbackUrl.toString()
			});
		}

		return json({ success: true });
	} catch (err) {
		console.error('Delegation verify error:', err);
		return json(
			{ error: 'server_error', error_description: 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
