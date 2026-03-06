import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { independentLogin } from '$lib/config';
import {
	getExportChallenge,
	getImportChallenge,
	getDeleteAegisChallenge,
	getDeleteAccountChallenge
} from '$lib/server/export-verify-store';

/**
 * GET /api/identity/export-challenge/:id
 *
 * Public endpoint for Syner to fetch challenge details (export or import).
 * Used with syr://export?challenge=...&instance=... for both flows.
 * Returns message, domain, expires_at (same shape as independent-login/challenge for compatibility).
 */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export const GET: RequestHandler = async ({ params }) => {
	const { id } = params;
	let challenge = await getExportChallenge(id);
	if (!challenge) {
		challenge = await getImportChallenge(id);
	}
	if (!challenge) {
		challenge = await getDeleteAegisChallenge(id);
	}
	if (!challenge) {
		challenge = await getDeleteAccountChallenge(id);
	}
	if (!challenge) {
		return json(
			{ error: 'challenge_expired', error_description: 'Challenge not found or expired' },
			{ status: 410, headers: NO_STORE }
		);
	}
	const expiryTs = challenge.created_at + independentLogin.challengeTtl * 1000;
	if (Date.now() > expiryTs) {
		return json(
			{ error: 'challenge_expired', error_description: 'Challenge not found or expired' },
			{ status: 410, headers: NO_STORE }
		);
	}
	const expiresAt = new Date(expiryTs).toISOString();
	return json(
		{
			message: challenge.message,
			domain: challenge.domain,
			expires_at: expiresAt,
			did: challenge.expected_did
		},
		{ headers: NO_STORE }
	);
};
