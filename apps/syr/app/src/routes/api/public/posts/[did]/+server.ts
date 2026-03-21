import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isValidSyrDid } from '@syr-is/did';
import { postController } from '$lib/controllers/post.controller';
import { extractDid, extractLocalId } from '@syr-is/types';

export const GET: RequestHandler = async ({ params, url }) => {
	const did = decodeURIComponent(params.did);
	if (!isValidSyrDid(did)) {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid DID' });
	}
	const limit = Math.min(
		100,
		Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10) || 30)
	);
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);

	const { data, total } = await postController.getPublicPostsByDid(did, limit, offset);

	const meta = data.map((p) => ({
		did: extractDid(p.id),
		local_id: extractLocalId(p.id),
		type: p.type,
		title: p.title,
		description: p.description,
		visibility: p.visibility,
		status: p.status,
		created_at: p.created_at,
		updated_at: p.updated_at,
		content_signature: p.content_signature,
		signed_payload_json: p.signed_payload_json,
		signing_device_public_key: p.signing_device_public_key,
		...(p.type === 'media'
			? { media_urls: p.media_urls, display_mode: p.display_mode }
			: { content_type: p.content_type })
	}));

	return json({
		status: 'success',
		data: meta,
		pagination: { limit, offset, total, has_more: offset + data.length < total }
	});
};
