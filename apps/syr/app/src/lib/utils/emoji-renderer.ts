/**
 * Render emoji shortcodes in HTML content.
 * Replaces :shortcode: with inline <img> tags.
 * Uses the provided emoji map (shortcode → url).
 *
 * For duplicate shortcodes from different sources, append ~1, ~2 etc.
 */
export function renderEmojisInHtml(html: string, emojiMap: Record<string, string>): string {
	if (!html || Object.keys(emojiMap).length === 0) return html;

	// Match :shortcode: but NOT ::shortcode:: (stickers handled separately)
	return html.replace(/(?<!:):([a-zA-Z0-9_~+-]+):(?!:)/g, (match, shortcode) => {
		const url = emojiMap[shortcode] ?? emojiMap[shortcode.toLowerCase()];
		if (!url) return match;
		return `<img src="${escapeHtml(url)}" alt=":${escapeHtml(shortcode)}:" class="custom-emoji" style="display:inline;aspect-ratio:1;width:1.5em;height:1.5em;margin:0 0.15em;vertical-align:middle;" />`;
	});
}

/**
 * Render sticker shortcodes (::shortcode::) as larger block images.
 */
export function renderStickersInHtml(html: string, emojiMap: Record<string, string>): string {
	if (!html || Object.keys(emojiMap).length === 0) return html;

	return html.replace(/::([a-zA-Z0-9_~+-]+)::/g, (match, shortcode) => {
		const url = emojiMap[shortcode] ?? emojiMap[shortcode.toLowerCase()];
		if (!url) return match;
		return `<img src="${escapeHtml(url)}" alt="::${escapeHtml(shortcode)}::" class="custom-sticker" style="display:block;max-width:128px;max-height:128px;margin:0.25em 0;" />`;
	});
}

/**
 * Build an emoji map from instance emojis and user emojis.
 * Handles duplicate shortcodes by appending ~1, ~2, etc.
 */
export function buildEmojiMap(
	instanceEmojis: Array<{ shortcode: string; url: string }>,
	userEmojis: Array<{ shortcode: string; url: string }> = []
): Record<string, string> {
	const map: Record<string, string> = {};
	const counts: Record<string, number> = {};

	function addEmoji(shortcode: string, url: string) {
		if (!(shortcode in map)) {
			map[shortcode] = url;
		} else {
			const count = (counts[shortcode] ?? 1) + 1;
			counts[shortcode] = count;
			map[`${shortcode}~${count - 1}`] = url;
		}
	}

	// Instance emojis first (higher priority)
	for (const emoji of instanceEmojis) {
		addEmoji(emoji.shortcode, emoji.url);
	}

	// Then user emojis
	for (const emoji of userEmojis) {
		addEmoji(emoji.shortcode, emoji.url);
	}

	return map;
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}
