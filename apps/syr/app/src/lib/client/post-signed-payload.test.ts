/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initCryptoWasm, generateRootKeypair, deriveDid } from '@syr-is/crypto';
import {
	buildPostSignedPayloadV1,
	signPostMutationWithRootKey,
	verifySignedMutationEnvelopeLocally
} from './post-signed-payload.js';

beforeAll(async () => {
	await initCryptoWasm();
});

describe('buildPostSignedPayloadV1', () => {
	it('builds create payload with post@v1 shape', () => {
		const p = buildPostSignedPayloadV1({
			did: 'did:syr:z6MkhaXgBZDvotDkLBT7pETLi3x5eR1iKXuUp',
			postLocalId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
			status: 'completed',
			mode: 'create',
			snapshot: {
				type: 'blog',
				title: 'Hi',
				content: 'Body',
				content_type: 'markdown',
				visibility: 'public'
			}
		});
		expect(p.type).toBe('post@v1');
		expect(p.post_id).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
		expect(p.post_type).toBe('blog');
		expect(p.status).toBe('completed');
		expect(p.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('uses existing created_at for update mode', () => {
		const iso = '2024-01-15T12:00:00.000Z';
		const p = buildPostSignedPayloadV1({
			did: 'did:syr:z6MkhaXgBZDvotDkLBT7pETLi3x5eR1iKXuUp',
			postLocalId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
			status: 'completed',
			mode: 'update',
			existingCreatedAtIso: iso,
			snapshot: {
				type: 'media',
				media_urls: ['https://x.example/a.jpg'],
				display_mode: 'masonry',
				visibility: 'unlisted'
			}
		});
		expect(p.created_at).toBe(iso);
		expect(p.post_type).toBe('media');
		expect(p.media_urls).toEqual(['https://x.example/a.jpg']);
	});
});

describe('signPostMutationWithRootKey', () => {
	it('produces a locally verifiable envelope', async () => {
		const kp = await generateRootKeypair();
		const did = deriveDid(kp.publicKey);
		const { encodeMultibase } = await import('@syr-is/crypto');
		const pubMb = encodeMultibase(kp.publicKey);
		const payload = buildPostSignedPayloadV1({
			did,
			postLocalId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
			status: 'completed',
			mode: 'create',
			snapshot: {
				type: 'blog',
				title: 'T',
				content: 'C',
				content_type: 'markdown',
				visibility: 'public'
			}
		});
		const env = await signPostMutationWithRootKey(payload, kp.privateKey, pubMb);
		expect(env.device_public_key).toBe(pubMb);
		expect(await verifySignedMutationEnvelopeLocally(env)).toBe(true);
	});
});
