import { error } from '@sveltejs/kit';

/*
 * AI-assisted module (Cursor / Composer-style agent in the Syr repo).
 *
 * Context: implement strict validation for user-supplied content-trust URL patterns before
 * persistence — trim, parse as URL, allow only http/https, return canonical `href`.
 *
 * Limitations / assumptions for reviewers:
 * - Does not resolve DNS, follow redirects, or verify that the host exists or is reachable.
 * - Does not perform SSRF-safe host blocklists; callers use this for pattern storage/matching only.
 * - Rejects non-absolute URLs and non-http(s) schemes; IDNA/punycode and unusual URL edge cases
 *   follow the WHATWG URL parser behavior of the runtime.
 * - Errors are thrown as SvelteKit `error(400, { code: 'VALIDATION_ERROR', message })` for API routes.
 */

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
