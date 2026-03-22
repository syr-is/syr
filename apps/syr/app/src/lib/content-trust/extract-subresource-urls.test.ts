import { describe, expect, it, beforeAll } from 'vitest';
import { Window } from 'happy-dom';
import { extractSubresourceUrlsFromHtml } from './extract-subresource-urls.js';

beforeAll(() => {
	const win = new Window({ url: 'https://app.test/' });
	Object.assign(globalThis, {
		window: win,
		document: win.document,
		DOMParser: win.DOMParser
	});
});

describe('extractSubresourceUrlsFromHtml', () => {
	it('collects img src and srcset', () => {
		const urls = extractSubresourceUrlsFromHtml(
			'<img src="/a.png" srcset="https://cdn.example.com/b.png 1x, https://cdn.example.com/c.png 2x">',
			'https://app.test/post/1'
		);
		expect(urls).toContain('https://app.test/a.png');
		expect(urls).toContain('https://cdn.example.com/b.png');
		expect(urls).toContain('https://cdn.example.com/c.png');
	});

	it('collects video src and inline style url()', () => {
		const urls = extractSubresourceUrlsFromHtml(
			'<div style="background:url(https://evil.test/bg)"><video src="https://v.test/m.mp4"></video></div>',
			'https://app.test/'
		);
		expect(urls).toContain('https://v.test/m.mp4');
		expect(urls).toContain('https://evil.test/bg');
	});
});
