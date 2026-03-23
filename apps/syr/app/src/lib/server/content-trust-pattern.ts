import { error } from '@sveltejs/kit';

/** Trim, validate absolute http(s) URL, return canonical href for persistence. */
export function assertContentTrustPatternUrl(pattern: string): string {
	const t = pattern.trim();
	let url: URL;
	try {
		url = new URL(t);
	} catch {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Each pattern must be a valid absolute URL (e.g. https://example.com/path)'
		});
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Content trust patterns must use http or https URLs only'
		});
	}
	return url.href;
}
