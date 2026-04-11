import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isValidSyrDid } from '@syr-is/did';
import { emojiController } from '$lib/controllers/emoji.controller';
import { extractDid, extractLocalId } from '@syr-is/types';

export const GET: RequestHandler = async ({ params, url }) => {
	const did = decodeURIComponent(params.did);
	if (!isValidSyrDid(did)) {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid DID' });
	}

	const limit = Math.min(
		100,
		Math.max(1, parseInt(url.searchParams.get('limit') ?? '100', 10) || 100)
	);
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);

	const { data, total } = await emojiController.getPublicEmojisByDid(did, { limit, offset });

	const serialized = data.map((e) => ({
		shortcode: e.shortcode,
		url: e.url,
		is_sticker: e.is_sticker,
		did: extractDid(e.id),
		local_id: extractLocalId(e.id)
	}));

	return json({
		status: 'success',
		data: serialized,
		pagination: { limit, offset, total, has_more: offset + data.length < total }
	});
};
