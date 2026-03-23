import { marked } from 'marked';
import { extractSubresourceUrlsFromHtml } from './extract-subresource-urls.js';
import type { PostBlogContentType, PostType } from '@syr-is/types';

export type PostLikeForSources = {
	type: PostType;
	content_type?: PostBlogContentType;
	content?: string | null;
	media_urls?: string[] | null;
};

function markedToHtml(markdown: string): string {
	const result = marked.parse(markdown, { gfm: true, breaks: true });
	return typeof result === 'string' ? result : '';
}

/**
 * Full set of subresource URLs for a post: `media_urls` plus HTML/markdown-derived URLs.
 * Markdown is compiled with the same options as the reader. Call only where DOMParser exists.
 */
export function collectPostSubresourceUrls(
	post: PostLikeForSources,
	resourceBase?: string
): string[] {
	const out = new Set<string>();
	const base = resourceBase ?? 'https://invalid.local/';

	for (const u of post.media_urls ?? []) {
		if (u?.trim()) {
			try {
				out.add(new URL(u.trim(), base).href);
			} catch {
				out.add(u.trim());
			}
		}
	}

	if (post.type === 'blog' && post.content) {
		if (post.content_type === 'html') {
			for (const u of extractSubresourceUrlsFromHtml(post.content, base)) out.add(u);
		} else if (post.content_type === 'markdown') {
			const html = markedToHtml(post.content);
			for (const u of extractSubresourceUrlsFromHtml(html, base)) out.add(u);
		}
	}

	return [...out];
}
