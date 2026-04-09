/**
 * Shared cache for instance emoji catalog.
 * All components (emoji picker, comment thread, reaction bar) share one fetch.
 */

type EmojiEntry = {
	shortcode: string;
	url: string;
	is_sticker: boolean;
};

let instancePromise: Promise<EmojiEntry[]> | null = null;

export function getInstanceEmojis(): Promise<EmojiEntry[]> {
	if (instancePromise) return instancePromise;

	instancePromise = (async () => {
		try {
			const res = await fetch('/api/public/emojis');
			if (!res.ok) return [];
			const json = await res.json();
			if (json.status === 'success') {
				return (json.data ?? []) as EmojiEntry[];
			}
		} catch {
			/* skip */
		}
		return [];
	})();

	return instancePromise;
}

const userEmojiCache = new Map<string, Promise<EmojiEntry[]>>();

export function getUserEmojis(endpointUrl: string): Promise<EmojiEntry[]> {
	if (userEmojiCache.has(endpointUrl)) return userEmojiCache.get(endpointUrl)!;

	const promise = (async () => {
		try {
			const res = await fetch(endpointUrl);
			if (!res.ok) return [];
			const json = await res.json();
			if (json.status === 'success' && json.data) {
				return json.data as EmojiEntry[];
			}
		} catch {
			/* skip */
		}
		return [];
	})();

	userEmojiCache.set(endpointUrl, promise);
	return promise;
}

/** Reset caches (e.g., on logout or when new emojis are added) */
export function clearEmojiCache() {
	instancePromise = null;
	userEmojiCache.clear();
}
