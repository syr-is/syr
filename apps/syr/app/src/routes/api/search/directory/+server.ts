import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { registryApiRoot } from '$lib/registry-url';

const ERROR_BODY_MAX_CHARS = 500;

/** Bounded read for error logging without buffering huge bodies. */
async function readResponseBodyPrefix(res: Response, maxChars: number): Promise<string> {
	if (!res.body) return '';
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let out = '';
	try {
		while (out.length < maxChars) {
			const { done, value } = await reader.read();
			if (done) break;
			out += decoder.decode(value, { stream: !done });
			if (out.length >= maxChars) {
				try {
					await reader.cancel();
				} catch {
					/* ignore */
				}
				break;
			}
		}
	} catch {
		try {
			await reader.cancel();
		} catch {
			/* ignore */
		}
	}
	return out.slice(0, maxChars);
}

/**
 * GET /api/search/directory?registryUrl=<base>&q=<query>&limit=<n>
 *
 * Proxies a single registry's directory search endpoint.
 * The client is responsible for querying multiple registries in parallel
 * and merging/deduplicating results.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	}

	const registryUrl = url.searchParams.get('registryUrl');
	if (!registryUrl) {
		throw error(400, { code: 'BAD_REQUEST', message: 'registryUrl query parameter is required' });
	}

	const q = url.searchParams.get('q') ?? '';
	const limitParam = url.searchParams.get('limit');
	const parsedLimit = parseInt(limitParam ?? '20', 10);
	const limit = Math.min(50, Math.max(1, Number.isNaN(parsedLimit) ? 20 : parsedLimit));

	let base: string;
	try {
		base = registryApiRoot(registryUrl);
	} catch {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid registry URL' });
	}

	const params = new URLSearchParams();
	if (q) params.set('q', q);
	params.set('limit', String(limit));

	try {
		const res = await fetch(`${base}/directory/search?${params.toString()}`, {
			signal: AbortSignal.timeout(12_000)
		});

		if (!res.ok) {
			const bodySnippet = await readResponseBodyPrefix(res, ERROR_BODY_MAX_CHARS);
			console.debug('directory search: non-OK registry response', {
				registryUrl,
				base,
				status: res.status,
				statusText: res.statusText,
				body: bodySnippet
			});
			return json({ status: 'success', data: [] });
		}

		const jsonBody = (await res.json()) as {
			data?: Array<{
				did: string;
				provider: string;
				username: string;
				displayName: string;
				updatedAt: string;
			}>;
		};

		const rows = (jsonBody.data ?? []).map((row) => ({
			...row,
			registryUrl: base
		}));

		return json({ status: 'success', data: rows });
	} catch (err) {
		console.debug('directory search registry failed', { registryUrl, base, err });
		return json({ status: 'success', data: [] });
	}
};
