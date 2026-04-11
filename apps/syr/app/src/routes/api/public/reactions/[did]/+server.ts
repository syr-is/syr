import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isValidSyrDid } from '@syr-is/did';
import { reactionController } from '$lib/controllers/reaction.controller';
import { extractDid, extractLocalId } from '@syr-is/types';

export const GET: RequestHandler = async ({ params, url }) => {
	const did = decodeURIComponent(params.did);
	if (!isValidSyrDid(did)) {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid DID' });
	}

	const parentType = url.searchParams.get('parent_type') ?? undefined;
	const parentDid = url.searchParams.get('parent_did') ?? undefined;
	const parentId = url.searchParams.get('parent_id') ?? undefined;

	// Require all three parent filters or none
	const parentParamsCount = [parentType, parentDid, parentId].filter(Boolean).length;
	if (parentParamsCount > 0 && parentParamsCount < 3) {
		throw error(400, {
			code: 'BAD_REQUEST',
			message: 'parent_type, parent_did, and parent_id must all be provided together'
		});
	}

	const limit = Math.min(
		100,
		Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50)
	);
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);

	const { data, total } = await reactionController.getPublicReactionsByDid(did, {
		parentType,
		parentDid,
		parentId,
		limit,
		offset
	});

	const serialized = data.map((r) => ({
		did: extractDid(r.id),
		local_id: extractLocalId(r.id),
		parent_type: r.parent_type,
		parent_did: r.parent_did,
		parent_id: r.parent_id,
		kind: r.kind,
		value: r.value,
		image_url: r.image_url ?? null,
		created_at: r.created_at.toISOString()
	}));

	return json({
		status: 'success',
		data: serialized,
		pagination: { limit, offset, total, has_more: offset + data.length < total }
	});
};
