/**
 * Shared cache for instance emoji catalog.
 * All components (emoji picker, comment thread, reaction bar) share one fetch.
 * On failure, the cache is cleared so the next call retries.
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
		const res = await fetch('/api/public/emojis');
		if (!res.ok) throw new Error(`Failed to fetch instance emojis: ${res.status}`);
		const json = await res.json();
		if (json.status === 'success') {
			return (json.data ?? []) as EmojiEntry[];
		}
		return [];
	})().catch(() => {
		// Clear cache on failure so next call retries
		instancePromise = null;
		return [] as EmojiEntry[];
	});

	return instancePromise;
}

const userEmojiCache = new Map<string, Promise<EmojiEntry[]>>();

export function getUserEmojis(endpointUrl: string): Promise<EmojiEntry[]> {
	if (userEmojiCache.has(endpointUrl)) return userEmojiCache.get(endpointUrl)!;

	const promise = (async () => {
		const res = await fetch(endpointUrl);
		if (!res.ok) throw new Error(`Failed: ${res.status}`);
		const json = await res.json();
		if (json.status === 'success' && json.data) {
			return json.data as EmojiEntry[];
		}
		return [];
	})().catch(() => {
		// Clear this URL from cache on failure so next call retries
		userEmojiCache.delete(endpointUrl);
		return [] as EmojiEntry[];
	});

	userEmojiCache.set(endpointUrl, promise);
	return promise;
}

/** Reset caches (e.g., on logout or when new emojis are added) */
export function clearEmojiCache() {
	instancePromise = null;
	userEmojiCache.clear();
}
