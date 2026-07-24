import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verify, decodeMultibase, encodeMultibase } from '@syr-is/crypto';
import { getCurrentRootKey } from '$lib/server/root-key.server';
import { AegisBundleSchema } from '@syr-is/types';
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
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return json(
				{ error: 'invalid_request', error_description: 'Invalid JSON body' },
				{ status: 400 }
			);
		}
		const { challenge_id, did, signature } = body as Record<string, string>;

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

		// Verify signature against the CURRENT root key (genesis + rotation chain)
		const { publicKey: currentRootKey } = await getCurrentRootKey(did);
		const signatureBytes = decodeMultibase(signature);
		const isValid = await verify(challenge.message, signatureBytes, currentRootKey);
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

		// Validate aegis_delegate structure
		const aegisParsed = AegisBundleSchema.safeParse(keypair.aegis_delegate);
		if (!aegisParsed.success) {
			return json(
				{
					error: 'keypair_corrupt',
					error_description: 'Pre-generated keypair has invalid encryption data'
				},
				{ status: 500 }
			);
		}

		// Verify the pending registration still exists before persisting the delegation
		const registration = await getPendingDelegation(challenge.delegation_id);
		if (!registration) {
			return json(
				{
					error: 'registration_expired',
					error_description: 'Platform registration expired before delegation could be stored'
				},
				{ status: 410 }
			);
		}

		// Validate callback URL before storing delegation (prevents post-store failures)
		let callbackUrl: URL;
		try {
			callbackUrl = new URL(registration.callback_url);
		} catch {
			return json(
				{
					error: 'invalid_request',
					error_description: 'Registration has a malformed callback URL'
				},
				{ status: 400 }
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
				aegisDelegate: aegisParsed.data,
				signatureMultibase,
				canonicalDelegation: keypair.canonical_statement,
				createdAt: new Date(keypair.created_at)
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Delegation creation failed';
			return json({ error: 'delegation_failed', error_description: msg }, { status: 500 });
		}

		// Set auth code and notify SSE
		const code = crypto.randomUUID();
		registration.did = did;
		registration.code = code;
		await setPendingDelegation(challenge.delegation_id, registration);

		callbackUrl.searchParams.set('code', code);
		callbackUrl.searchParams.set('delegation_id', challenge.delegation_id);
		if (registration.state) {
			callbackUrl.searchParams.set('state', registration.state);
		}

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
