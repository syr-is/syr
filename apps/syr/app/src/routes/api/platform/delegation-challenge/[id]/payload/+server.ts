import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDelegationChallenge } from '$lib/server/platform-delegation-store';

/**
 * GET /api/platform/delegation-challenge/[id]/payload
 *
 * Syner fetches this to get the canonical delegation statement and platform details.
 * Read-only — does NOT consume the challenge.
 */
export const GET: RequestHandler = async ({ params }) => {
	const challenge = await getDelegationChallenge(params.id);
	if (!challenge) {
		return json(
			{ error: 'challenge_expired', error_description: 'Challenge not found or expired' },
			{ status: 410, headers: { 'Cache-Control': 'no-store' } }
		);
	}

	// Parse platform details from the canonical statement
	let platformName = '';
	let platformOrigin = '';
	let delegatePublicKey = '';
	let did = '';
	try {
		const parsed = JSON.parse(challenge.message);
		platformName = parsed.platform_name ?? '';
		platformOrigin = parsed.platform_origin ?? '';
		delegatePublicKey = parsed.delegate ?? '';
		did = parsed.did ?? '';
	} catch {
		// message is the raw canonical string, try to extract
	}

	return json(
		{
			message: challenge.message,
			platform_name: platformName,
			platform_origin: platformOrigin,
			delegate_public_key: delegatePublicKey,
			did
		},
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};
