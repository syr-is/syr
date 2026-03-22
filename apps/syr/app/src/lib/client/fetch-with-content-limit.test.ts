import { describe, expect, it } from 'vitest';
import {
	estimatePostPayloadBytes,
	partitionPostsByPayloadLimit,
	buildOrderedFeedEntries
} from './fetch-with-content-limit.js';

describe('estimatePostPayloadBytes', () => {
	it('sums string fields as UTF-8', () => {
		const post = { content: 'a'.repeat(100), title: 'x' };
		expect(estimatePostPayloadBytes(post)).toBeGreaterThanOrEqual(100);
	});

	it('includes media_urls JSON', () => {
		const post = { media_urls: ['https://a.com/x', 'https://b.com/y'] };
		expect(estimatePostPayloadBytes(post)).toBeGreaterThan(20);
	});
});

describe('partitionPostsByPayloadLimit', () => {
	it('splits by limit and respects override', () => {
		const posts = [
			{ id: '1', content: 'small' },
			{ id: '2', content: 'x'.repeat(5000) }
		];
		const { within, oversized } = partitionPostsByPayloadLimit(posts, 100, () => false);
		expect(within.length).toBe(1);
		expect(oversized.length).toBe(1);
		const all = partitionPostsByPayloadLimit(posts, 100, (p) => p.id === '2');
		expect(all.within.length).toBe(2);
		expect(all.oversized.length).toBe(0);
	});
});

describe('buildOrderedFeedEntries', () => {
	it('preserves order', () => {
		const raw = [
			{ id: '1', content: 'a' },
			{ id: '2', content: 'y'.repeat(200) }
		];
		const entries = buildOrderedFeedEntries(raw, 50, () => false);
		expect(entries.length).toBe(2);
		expect(entries[0]?.kind).toBe('post');
		expect(entries[1]?.kind).toBe('oversized');
	});
});
