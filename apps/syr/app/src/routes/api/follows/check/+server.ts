import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { followController } from '$lib/controllers/follow.controller';
import { stringToRecordId } from '@syr-is/types';
import { isValidSyrDid } from '@syr-is/did';

/**
 * GET /api/follows/check?did=did:syr:…&provider=https://…
 * Returns whether the current user follows the given DID.
 * When provider is given, checks for that specific instance only.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	}
	const did = url.searchParams.get('did')?.trim();
	if (!did || !isValidSyrDid(did)) {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Valid did query parameter required' });
	}
	const provider = url.searchParams.get('provider')?.trim().replace(/\/$/, '') || undefined;
	const userId = stringToRecordId.decode(locals.user.id);
	const following = await followController.isFollowing(userId, did, provider);
	return json({
		status: 'success',
		data: { following }
	});
};
