import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { identityRepository } from '$lib/repositories/identity.repository';
import { buildAegisBundleFromIdentity } from '$lib/utils/aegis-bundle.server';
import { stringToRecordId } from '@syr-is/types';
import { consumeDeleteAegisToken, setDeleteAegisToken } from '$lib/server/export-verify-store';

const DeleteAegisRequestSchema = z.object({
	delete_aegis_token: z.string().uuid()
});

/**
 * POST /api/identity/delete-aegis
 *
 * Removes Aegis (server-stored encrypted seed) from the authenticated user's identity.
 * Requires delete_aegis_token from Syner verification (user must sign challenge with Syner
 * to prove they have backed up their keys).
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

	const parsed = DeleteAegisRequestSchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Missing or invalid delete_aegis_token — sign with Syner to obtain token',
			details: JSON.parse(JSON.stringify(parsed.error.issues))
		});
	}

	const tokenUserId = await consumeDeleteAegisToken(parsed.data.delete_aegis_token);
	if (!tokenUserId || tokenUserId !== locals.user.id) {
		throw error(403, {
			code: 'INVALID_TOKEN',
			message: 'Invalid or expired delete-aegis token'
		});
	}
	try {
		await identityRepository.removeAegisByUserId(userId);
	} catch (_e) {
		// Compensating action: restore token so user can retry without Syner
		await setDeleteAegisToken(parsed.data.delete_aegis_token, { user_id: locals.user.id });
		throw error(500, {
			code: 'REMOVE_AEGIS_FAILED',
			message: 'Failed to remove Aegis — please try again'
		});
	}
	return json({ success: true, message: 'Aegis removed' });
};
