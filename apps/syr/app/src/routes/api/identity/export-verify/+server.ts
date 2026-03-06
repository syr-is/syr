import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { verify, decodeMultibase } from '@syr-is/crypto';
import { parseDid } from '@syr-is/did';
import {
	consumeExportChallenge,
	consumeImportChallenge,
	consumePublicImportChallenge,
	consumeDeleteAegisChallenge,
	consumeDeleteAccountChallenge,
	setExportToken,
	setImportToken,
	setPublicImportToken,
	setDeleteAegisToken,
	setDeleteAccountToken,
	type ImportChallengeData,
	type DeleteAegisChallengeData,
	type DeleteAccountChallengeData
} from '$lib/server/export-verify-store';
import {
	notifyExportVerified,
	notifyImportVerified,
	notifyDeleteAegisVerified,
	notifyDeleteAccountVerified
} from '$lib/server/export-verify-broadcast';

const VerifyRequestSchema = z.object({
	challenge_id: z.string().uuid(),
	did: z.string().startsWith('did:syr:'),
	signature: z.string().min(1)
});

/**
 * POST /api/identity/export-verify
 *
 * Verifies the signature for export or import challenge.
 * Syner calls this after user signs. No auth required.
 * Creates export_token or import_token and notifies SSE subscribers.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const data = VerifyRequestSchema.parse(body);

		// Atomically consume export challenge first, then import, then public import, then delete-aegis, then delete-account
		let challenge = await consumeExportChallenge(data.challenge_id);
		let purpose: 'export' | 'import' | 'import_public' | 'delete_aegis' | 'delete_account' =
			'export';

		if (!challenge) {
			challenge = await consumeImportChallenge(data.challenge_id);
			purpose = 'import';
		}
		if (!challenge) {
			challenge = await consumePublicImportChallenge(data.challenge_id);
			purpose = 'import_public';
		}
		if (!challenge) {
			challenge = await consumeDeleteAegisChallenge(data.challenge_id);
			purpose = 'delete_aegis';
		}
		if (!challenge) {
			challenge = await consumeDeleteAccountChallenge(data.challenge_id);
			purpose = 'delete_account';
		}

		if (!challenge) {
			return json(
				{ error: 'challenge_expired', error_description: 'Challenge not found or expired' },
				{ status: 410 }
			);
		}

		if (data.did !== challenge.expected_did) {
			return json(
				{ error: 'did_mismatch', error_description: 'DID does not match challenge' },
				{ status: 403 }
			);
		}

		let parsedDid;
		let signatureBytes;
		try {
			parsedDid = parseDid(data.did);
			signatureBytes = decodeMultibase(data.signature);
		} catch {
			return json(
				{ error: 'invalid_request', error_description: 'Malformed DID or signature format' },
				{ status: 400 }
			);
		}

		const messageBytes = new TextEncoder().encode(challenge.message);

		const isValid = await verify(messageBytes, signatureBytes, parsedDid.publicKey);
		if (!isValid) {
			return json(
				{ error: 'invalid_signature', error_description: 'Signature verification failed' },
				{ status: 403 }
			);
		}

		if (purpose === 'export') {
			const exportToken = crypto.randomUUID();
			// We need user_id - export challenge has expected_did, we need to look up user by did
			const { identityRepository } = await import('$lib/repositories/identity.repository');
			const identity = await identityRepository.findByDid(data.did);
			if (!identity) {
				return json(
					{ error: 'server_error', error_description: 'Identity not found' },
					{ status: 500 }
				);
			}
			await setExportToken(exportToken, identity.user_id.toString());
			notifyExportVerified(data.challenge_id, exportToken);
			return json({ success: true as const, export_token: exportToken });
		} else if (purpose === 'delete_aegis') {
			const deleteAegisToken = crypto.randomUUID();
			await setDeleteAegisToken(deleteAegisToken, {
				user_id: (challenge as DeleteAegisChallengeData).user_id
			});
			notifyDeleteAegisVerified(data.challenge_id, deleteAegisToken);
			return json({ success: true as const, delete_aegis_token: deleteAegisToken });
		} else if (purpose === 'delete_account') {
			const deleteAccountToken = crypto.randomUUID();
			await setDeleteAccountToken(deleteAccountToken, {
				user_id: (challenge as DeleteAccountChallengeData).user_id
			});
			notifyDeleteAccountVerified(data.challenge_id, deleteAccountToken);
			return json({ success: true as const, delete_account_token: deleteAccountToken });
		} else if (purpose === 'import_public') {
			const importToken = crypto.randomUUID();
			await setPublicImportToken(importToken, { did: data.did });
			notifyImportVerified(data.challenge_id, importToken);
			return json({ success: true as const, import_token: importToken });
		} else {
			const importToken = crypto.randomUUID();
			await setImportToken(importToken, {
				user_id: (challenge as ImportChallengeData).user_id,
				did: data.did
			});
			notifyImportVerified(data.challenge_id, importToken);
			return json({ success: true as const, import_token: importToken });
		}
	} catch (err) {
		if (err instanceof z.ZodError) {
			return json(
				{ error: 'invalid_request', error_description: 'Invalid verify request' },
				{ status: 400 }
			);
		}
		if (err instanceof SyntaxError) {
			return json({ error: 'invalid_request', error_description: 'Invalid JSON' }, { status: 400 });
		}
		console.error('Export/import verify error:', err);
		return json(
			{ error: 'server_error', error_description: 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
