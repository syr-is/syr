import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { verify, decodeMultibase } from '@syr-is/crypto';
import { parseDid } from '@syr-is/did';
import { identityRepository } from '$lib/repositories/identity.repository';
import { buildAegisBundleFromIdentity } from '$lib/utils/aegis-bundle.server';
import { stringToRecordId } from '@syr-is/types';
import {
	getDeleteAegisChallenge,
	consumeDeleteAegisChallenge,
	peekDeleteAegisToken,
	consumeDeleteAegisToken
} from '$lib/server/export-verify-store';

const InAppRequestSchema = z.object({
	challenge_id: z.string().uuid(),
	signature: z.string().min(1)
});

const SynerRequestSchema = z.object({
	delete_aegis_token: z.string().uuid()
});

/**
 * POST /api/identity/delete-aegis
 *
 * Removes Aegis (server-stored encrypted seed) from the authenticated user's identity.
 * Requires signature verification: either in-app (challenge_id + signature) or Syner (delete_aegis_token).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	const userId = stringToRecordId.decode(locals.user.id);
	const identity = await identityRepository.findByUserId(userId);
	if (!identity) {
		throw error(404, { code: 'NO_IDENTITY', message: 'User has no identity' });
	}

	const aegisBundle = buildAegisBundleFromIdentity(identity);
	if (!aegisBundle) {
		throw error(400, {
			code: 'NO_AEGIS',
			message: 'Identity has no Aegis — nothing to delete'
		});
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { code: 'INVALID_JSON', message: 'Invalid JSON body' });
	}

	// Try Syner path first (token)
	const synerParsed = SynerRequestSchema.safeParse(body);
	if (synerParsed.success) {
		const tokenUserId = await peekDeleteAegisToken(synerParsed.data.delete_aegis_token);
		if (!tokenUserId || tokenUserId !== locals.user.id) {
			throw error(403, {
				code: 'INVALID_TOKEN',
				message: 'Invalid or expired delete-aegis token'
			});
		}
		await consumeDeleteAegisToken(synerParsed.data.delete_aegis_token);
		await identityRepository.removeAegisByUserId(userId);
		return json({ success: true, message: 'Aegis removed' });
	}

	// In-app path: challenge_id + signature
	const inAppParsed = InAppRequestSchema.safeParse(body);
	if (!inAppParsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Provide either delete_aegis_token (Syner) or challenge_id + signature (in-app)',
			details: JSON.parse(JSON.stringify(inAppParsed.error.issues))
		});
	}

	const { challenge_id, signature } = inAppParsed.data;
	const challenge = await getDeleteAegisChallenge(challenge_id);
	if (!challenge) {
		throw error(410, {
			code: 'CHALLENGE_EXPIRED',
			message: 'Challenge not found or expired'
		});
	}

	if (challenge.user_id !== locals.user.id) {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'Challenge does not match authenticated user'
		});
	}

	if (challenge.expected_did !== identity.did) {
		throw error(403, {
			code: 'DID_MISMATCH',
			message: 'Challenge DID does not match identity'
		});
	}

	let signatureBytes: Uint8Array;
	try {
		signatureBytes = decodeMultibase(signature);
	} catch {
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'Malformed signature format'
		});
	}

	const messageBytes = new TextEncoder().encode(challenge.message);
	let parsedDid;
	try {
		parsedDid = parseDid(identity.did);
	} catch {
		throw error(500, {
			code: 'SERVER_ERROR',
			message: 'Invalid identity DID'
		});
	}

	const isValid = await verify(messageBytes, signatureBytes, parsedDid.publicKey);
	if (!isValid) {
		throw error(403, {
			code: 'INVALID_SIGNATURE',
			message: 'Signature verification failed'
		});
	}

	await consumeDeleteAegisChallenge(challenge_id);
	await identityRepository.removeAegisByUserId(userId);
	return json({ success: true, message: 'Aegis removed' });
};
