import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { emojiController } from '$lib/controllers/emoji.controller';
import { extractDid, extractLocalId } from '@syr-is/types';

export const GET: RequestHandler = async () => {
	const { data } = await emojiController.getInstanceCatalog();

	const emojis = data.map((emoji) => ({
		shortcode: emoji.shortcode,
		url: emoji.url,
		is_sticker: emoji.is_sticker,
		did: extractDid(emoji.id),
		local_id: extractLocalId(emoji.id)
	}));

	return json({
		status: 'success',
		data: emojis
	});
};
