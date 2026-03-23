import type { PostLikeForSources } from './post-sources.js';

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((v) => stableStringify(v)).join(',')}]`;
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	return `{${keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',')}}`;
}

/** Stable fingerprint for consent invalidation when body or signature changes. */
export function postContentFingerprint(
	post: PostLikeForSources & { content_signature?: string | null }
): string {
	const payload = stableStringify({
		type: post.type,
		content_type: post.content_type ?? null,
		content: post.content ?? '',
		media_urls: post.media_urls ?? [],
		content_signature: post.content_signature ?? ''
	});
	let h = 5381;
	for (let i = 0; i < payload.length; i++) {
		h = (h * 33) ^ payload.charCodeAt(i);
	}
	return (h >>> 0).toString(16);
}
