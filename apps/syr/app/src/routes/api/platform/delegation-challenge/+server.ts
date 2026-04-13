import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	generateDeviceKeypair,
	canonicalize,
	encodeMultibase,
	ED25519_MULTICODEC_PREFIX
} from '@syr-is/crypto';
import { config, platformDelegation } from '$lib/config';
import { encryptDelegateKey } from '$lib/services/platform-key-encryption';
import {
	getPendingDelegation,
	setPendingDelegation,
	setPendingKeypair,
	setDelegationChallenge
} from '$lib/server/platform-delegation-store';

/**
 * POST /api/platform/delegation-challenge
 *
 * Round 1 of the two-round Syner delegation flow.
 * Generates the delegate keypair upfront, builds the canonical delegation statement
 * with the real public key, and returns a syr://delegate deeplink for Syner.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'unauthorized' }, { status: 401 });
	}

	try {
		const body = await request.json();
		const { delegation_id } = body;

		if (!delegation_id) {
			return json(
				{ error: 'invalid_request', error_description: 'delegation_id is required' },
				{ status: 400 }
			);
		}

		// Look up pending registration for platform details
		const registration = await getPendingDelegation(delegation_id);
		if (!registration) {
			return json(
				{
					error: 'registration_expired',
					error_description: 'Platform registration not found or expired'
				},
				{ status: 410 }
			);
		}

		// Resolve DID: use registration's DID, or fall back to the session's DID
		const did = registration.did || locals.user.did || '';
		if (!did) {
			return json(
				{ error: 'invalid_request', error_description: 'No identity found for this user' },
				{ status: 400 }
			);
		}
		if (!registration.did) {
			// Backfill so subsequent calls and the verify flow have the DID
			registration.did = did;
			await setPendingDelegation(delegation_id, registration);
		}

		// Generate delegate keypair
		const delegateKeypair = await generateDeviceKeypair();
		const delegatePublicKeyMultibase = encodeMultibase(
			new Uint8Array([...ED25519_MULTICODEC_PREFIX, ...delegateKeypair.publicKey])
		);

		// Build canonical delegation statement with the REAL delegate key
		const now = new Date();
		const delegationStatement = {
			did,
			delegate: delegatePublicKeyMultibase,
			scope: 'platform' as const,
			platform_origin: registration.platform_origin,
			platform_name: registration.platform_name,
			createdAt: now.toISOString()
		};
		const canonicalStatement = canonicalize(delegationStatement);

		// Encrypt delegate private key, then zero raw
		let aegisDelegate;
		try {
			aegisDelegate = await encryptDelegateKey(delegateKeypair.privateKey);
		} finally {
			delegateKeypair.privateKey.fill(0);
		}

		// Store pre-generated keypair for Round 2
		await setPendingKeypair(delegation_id, {
			delegation_id,
			delegate_public_key_multibase: delegatePublicKeyMultibase,
			aegis_delegate: aegisDelegate,
			canonical_statement: canonicalStatement,
			did,
			platform_origin: registration.platform_origin,
			platform_name: registration.platform_name,
			created_at: Date.now()
		});

		// Store challenge for Syner verify
		const challengeId = crypto.randomUUID();
		await setDelegationChallenge(challengeId, {
			message: canonicalStatement,
			delegation_id,
			user_id: locals.user.id.toString(),
			created_at: Date.now()
		});

		// Build syr://delegate deeplink
		const deeplinkParams = new URLSearchParams({
			challenge: challengeId,
			instance: config.PUBLIC_URL,
			platform_name: registration.platform_name,
			platform_origin: registration.platform_origin,
			did,
			delegate: delegatePublicKeyMultibase
		});
		const deeplinkUrl = `syr://delegate?${deeplinkParams.toString()}`;

		return json({
			challenge_id: challengeId,
			message: canonicalStatement,
			deeplink_url: deeplinkUrl,
			delegate_public_key: delegatePublicKeyMultibase,
			expires_in: platformDelegation.registrationExpiresIn
		});
	} catch (err) {
		console.error('Delegation challenge error:', err);
		return json(
			{ error: 'server_error', error_description: 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
