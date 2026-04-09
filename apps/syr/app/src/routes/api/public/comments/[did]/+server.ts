import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isValidSyrDid } from '@syr-is/did';
import { commentController } from '$lib/controllers/comment.controller';
import { extractDid, extractLocalId } from '@syr-is/types';

export const GET: RequestHandler = async ({ params, url }) => {
	const did = decodeURIComponent(params.did);
	if (!isValidSyrDid(did)) {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid DID' });
	}

	const parentType = url.searchParams.get('parent_type') ?? undefined;
	const parentDid = url.searchParams.get('parent_did') ?? undefined;
	const parentId = url.searchParams.get('parent_id') ?? undefined;
	const limit = Math.min(
		100,
		Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50)
	);
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);

	const { data, total } = await commentController.getPublicCommentsByDid(did, {
		parentType,
		parentDid,
		parentId,
		limit,
		offset
	});

	const serialized = data.map((c) => ({
		did: extractDid(c.id),
		local_id: extractLocalId(c.id),
		parent_type: c.parent_type,
		parent_did: c.parent_did,
		parent_id: c.parent_id,
		content: c.content,
		visibility: c.visibility,
		status: c.status,
		created_at: c.created_at.toISOString(),
		updated_at: c.updated_at.toISOString(),
		content_signature: c.content_signature,
		signed_payload_json: c.signed_payload_json,
		signing_device_public_key: c.signing_device_public_key
	}));

	return json({
		status: 'success',
		data: serialized,
		pagination: { limit, offset, total, has_more: offset + data.length < total }
	});
};
