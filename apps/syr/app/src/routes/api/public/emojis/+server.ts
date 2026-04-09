import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { emojiController } from '$lib/controllers/emoji.controller';
import { extractDid, extractLocalId } from '@syr-is/types';

export const GET: RequestHandler = async () => {
	const { data } = await emojiController.getInstanceCatalog();

	const packs = await emojiController.getPacks();

	const packMap = new Map<string, { slug: string; name: string; emojis: unknown[] }>();
	for (const pack of packs.data) {
		packMap.set(pack.slug, { slug: pack.slug, name: pack.name, emojis: [] });
	}

	const ungrouped: unknown[] = [];
	for (const emoji of data) {
		const serialized = {
			shortcode: emoji.shortcode,
			url: emoji.url,
			is_sticker: emoji.is_sticker,
			did: extractDid(emoji.id),
			local_id: extractLocalId(emoji.id)
		};
		if (emoji.pack_slug && packMap.has(emoji.pack_slug)) {
			packMap.get(emoji.pack_slug)!.emojis.push(serialized);
		} else {
			ungrouped.push(serialized);
		}
	}

	return json({
		status: 'success',
		data: {
			packs: Array.from(packMap.values()),
			ungrouped
		}
	});
};
