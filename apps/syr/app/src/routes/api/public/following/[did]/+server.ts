import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isValidSyrDid } from '@syr-is/did';
import { followRepository } from '$lib/repositories/follow.repository';
import { publicFollowRowToJson } from '$lib/server/follow-row-json.server';

/**
 * GET /api/public/following/[did]
 *
 * Returns the list of DIDs that this user publicly follows.
 * Only follows with is_public = true are included.
 * No authentication required.
 */
export const GET: RequestHandler = async ({ params }) => {
	const did = decodeURIComponent(params.did);
	if (!isValidSyrDid(did)) {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid DID' });
	}

	const rows = await followRepository.findPublicByDid(did);
	return json({
		status: 'success',
		data: rows.map(publicFollowRowToJson),
		pagination: {
			total: rows.length
		}
	});
};
