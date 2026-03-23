import { describe, expect, it } from 'vitest';
import type { Post } from '@syr-is/types';
import {
	estimatePostPayloadBytes,
	partitionPostsByPayloadLimit,
	buildOrderedFeedEntries
} from './fetch-with-content-limit.js';

const did = 'did:syr:z6MkhaXg5DLEFB6LA3mofKxWBX99HupW';
const localId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** Minimal valid `Post` shape for client-side size estimation tests. */
function makeTestPost(overrides: Partial<Post> = {}): Post {
	const now = new Date();
	return {
		id: `post:⟨${did}⟩⟨${localId}⟩` as unknown as Post['id'],
		created_at: now,
		updated_at: now,
		type: 'blog',
		content_type: 'markdown',
		visibility: 'public',
		status: 'completed',
		author_id: `user:⟨01HVZ7WZ0000000000000001⟩` as unknown as Post['author_id'],
		title: '',
		content: '',
		did,
		local_id: localId,
		...overrides
	} as Post;
}

describe('estimatePostPayloadBytes', () => {
	it('sums string fields as UTF-8', () => {
		const post = makeTestPost({ content: 'a'.repeat(100), title: 'x' });
		expect(
			estimatePostPayloadBytes(post as unknown as Record<string, unknown>)
		).toBeGreaterThanOrEqual(100);
	});

	it('includes media_urls JSON', () => {
		const post = makeTestPost({
			type: 'media',
			content_type: undefined,
			media_urls: ['https://a.com/x', 'https://b.com/y']
		});
		expect(estimatePostPayloadBytes(post as unknown as Record<string, unknown>)).toBeGreaterThan(
			20
		);
	});
});

describe('partitionPostsByPayloadLimit', () => {
	it('splits by limit and respects override', () => {
		const posts = [
			makeTestPost({
				id: `post:⟨${did}⟩⟨01ARZ3NDEKTSV4RRFFQ69G5FV1⟩` as unknown as Post['id'],
				content: 'small'
			}),
			makeTestPost({
				id: `post:⟨${did}⟩⟨01ARZ3NDEKTSV4RRFFQ69G5FV2⟩` as unknown as Post['id'],
				content: 'x'.repeat(5000)
			})
		];
		const { within, oversized } = partitionPostsByPayloadLimit(
			posts as unknown[],
			100,
			() => false
		);
		expect(within.length).toBe(1);
		expect(oversized.length).toBe(1);
		const all = partitionPostsByPayloadLimit(posts as unknown[], 100, (p) => {
			const a = p as { id?: unknown };
			const b = posts[1] as { id?: unknown } | undefined;
			return String(a.id) === String(b?.id);
		});
		expect(all.within.length).toBe(2);
		expect(all.oversized.length).toBe(0);
	});
});

describe('buildOrderedFeedEntries', () => {
	it('preserves order', () => {
		const raw = [
			makeTestPost({
				id: `post:⟨${did}⟩⟨01ARZ3NDEKTSV4RRFFQ69G5FA1⟩` as unknown as Post['id'],
				content: 'a'
			}),
			makeTestPost({
				id: `post:⟨${did}⟩⟨01ARZ3NDEKTSV4RRFFQ69G5FA2⟩` as unknown as Post['id'],
				content: 'y'.repeat(200)
			})
		];
		const entries = buildOrderedFeedEntries(raw as unknown[], 50, () => false);
		expect(entries.length).toBe(2);
		expect(entries[0]?.kind).toBe('post');
		expect(entries[1]?.kind).toBe('oversized');
	});
});
