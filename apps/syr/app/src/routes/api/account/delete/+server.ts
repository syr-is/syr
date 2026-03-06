import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { peekDeleteAccountToken, consumeDeleteAccountToken } from '$lib/server/export-verify-store';
import { deleteAccount } from '$lib/services/account-deletion.service';

const DeleteAccountRequestSchema = z.object({
	delete_account_token: z.string().uuid()
});

/**
 * POST /api/account/delete
 *
 * Permanently deletes the account and all associated data.
 * Requires delete_account_token from Syner verification or Aegis password verification.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { code: 'INVALID_JSON', message: 'Invalid JSON body' });
	}

	const parsed = DeleteAccountRequestSchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message:
				'Missing or invalid delete_account_token — sign with Syner or provide password to obtain token',
			details: JSON.parse(JSON.stringify(parsed.error.issues))
		});
	}

	const tokenUserId = await peekDeleteAccountToken(parsed.data.delete_account_token);
	if (!tokenUserId || tokenUserId !== locals.user.id) {
		throw error(403, {
			code: 'INVALID_TOKEN',
			message: 'Invalid or expired delete-account token'
		});
	}

	await consumeDeleteAccountToken(parsed.data.delete_account_token);
	await deleteAccount(locals.user.id);

	return json({ success: true, message: 'Account deleted' });
};
