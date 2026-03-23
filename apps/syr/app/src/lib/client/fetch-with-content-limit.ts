import type { Post } from '@syr-is/types';
import { MAX_JSON_RESPONSE_BYTES } from './content-limit-config.js';

const textEncoder = new TextEncoder();

export type FeedEntry =
	| { kind: 'post'; post: Post }
	| { kind: 'oversized'; post: Post; estimatedBytes: number };

/**
 * UTF-8 byte size of fields that dominate post JSON (decoded body estimate).
 */
export function estimatePostPayloadBytes(post: Record<string, unknown>): number {
	let n = 0;
	for (const key of [
		'content',
		'description',
		'title',
		'signed_payload_json',
		'content_signature',
		'signing_device_public_key'
	] as const) {
		const v = post[key];
		if (typeof v === 'string') n += textEncoder.encode(v).length;
	}
	const mu = post.media_urls;
	if (Array.isArray(mu)) {
		n += textEncoder.encode(JSON.stringify(mu)).length;
	}
	return n;
}

export type FetchJsonLimitResult =
	| { ok: true; rawByteLength: number; json: unknown }
	| { ok: false; error: 'too_large'; rawByteLength: number; limit: number }
	| { ok: false; error: 'network'; message: string };

/**
 * Fetch URL, reject if raw body exceeds maxRawBytes (streaming), then JSON.parse.
 */
export async function fetchJsonWithByteLimit(
	url: string,
	options: { maxRawBytes: number; signal?: AbortSignal }
): Promise<FetchJsonLimitResult> {
	try {
		const res = await fetch(url, { signal: options.signal });
		if (!res.ok) {
			return { ok: false, error: 'network', message: `HTTP ${res.status}` };
		}
		const reader = res.body?.getReader();
		if (!reader) {
			return { ok: false, error: 'network', message: 'No response body' };
		}
		const chunks: Uint8Array[] = [];
		let rawByteLength = 0;
		const max = options.maxRawBytes;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value?.byteLength) {
				rawByteLength += value.byteLength;
				if (rawByteLength > max) {
					await reader.cancel().catch(() => {});
					return { ok: false, error: 'too_large', rawByteLength, limit: max };
				}
				chunks.push(value);
			}
		}
		const buf = new Uint8Array(rawByteLength);
		let offset = 0;
		for (const c of chunks) {
			buf.set(c, offset);
			offset += c.byteLength;
		}
		const text = new TextDecoder().decode(buf);
		try {
			return { ok: true, rawByteLength, json: JSON.parse(text) as unknown };
		} catch {
			return { ok: false, error: 'network', message: 'Invalid JSON' };
		}
	} catch (e) {
		return {
			ok: false,
			error: 'network',
			message: e instanceof Error ? e.message : String(e)
		};
	}
}

export function partitionPostsByPayloadLimit(
	posts: unknown[],
	maxPayloadBytes: number,
	isOverridden: (post: Record<string, unknown>) => boolean
): {
	within: unknown[];
	oversized: Array<{ post: Record<string, unknown>; estimatedBytes: number }>;
} {
	const within: unknown[] = [];
	const oversized: Array<{ post: Record<string, unknown>; estimatedBytes: number }> = [];
	for (const p of posts) {
		if (!p || typeof p !== 'object') continue;
		const rec = p as Record<string, unknown>;
		if (isOverridden(rec)) {
			within.push(p);
			continue;
		}
		const est = estimatePostPayloadBytes(rec);
		if (est > maxPayloadBytes) {
			oversized.push({ post: rec, estimatedBytes: est });
		} else {
			within.push(p);
		}
	}
	return { within, oversized };
}

/** Preserve API order; mark oversized posts without loading their bodies into previews. */
export function buildOrderedFeedEntries(
	raw: unknown[],
	maxPayloadBytes: number,
	isOverridden: (post: Record<string, unknown>) => boolean
): FeedEntry[] {
	const out: FeedEntry[] = [];
	for (const p of raw) {
		if (!p || typeof p !== 'object') continue;
		const rec = p as Record<string, unknown>;
		if (isOverridden(rec)) {
			out.push({ kind: 'post', post: rec as Post });
			continue;
		}
		const est = estimatePostPayloadBytes(rec);
		if (est > maxPayloadBytes) {
			out.push({ kind: 'oversized', post: rec as Post, estimatedBytes: est });
		} else {
			out.push({ kind: 'post', post: rec as Post });
		}
	}
	return out;
}

export type PublicPostFetchResult =
	| { ok: true; data: Record<string, unknown> }
	| {
			ok: false;
			error: 'too_large';
			kind: 'raw' | 'payload';
			byteLength: number;
			limit: number;
	  }
	| { ok: false; error: 'network'; message: string };

/**
 * Single public post JSON: raw cap + decoded payload estimate (compression-safe second line).
 */
export async function fetchPublicPostWithLimits(
	url: string,
	opts: { maxPayloadBytes: number; signal?: AbortSignal }
): Promise<PublicPostFetchResult> {
	const r = await fetchJsonWithByteLimit(url, {
		maxRawBytes: MAX_JSON_RESPONSE_BYTES,
		signal: opts.signal
	});
	if (!r.ok) {
		if (r.error === 'too_large') {
			return {
				ok: false,
				error: 'too_large',
				kind: 'raw',
				byteLength: r.rawByteLength,
				limit: r.limit
			};
		}
		return { ok: false, error: 'network', message: r.message };
	}
	const root = r.json as Record<string, unknown>;
	const data = root?.data;
	if (!data || typeof data !== 'object') {
		return { ok: false, error: 'network', message: 'Bad response shape' };
	}
	const rec = data as Record<string, unknown>;
	const est = estimatePostPayloadBytes(rec);
	if (est > opts.maxPayloadBytes) {
		return {
			ok: false,
			error: 'too_large',
			kind: 'payload',
			byteLength: est,
			limit: opts.maxPayloadBytes
		};
	}
	return { ok: true, data: rec };
}
