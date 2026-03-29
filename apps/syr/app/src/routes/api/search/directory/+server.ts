import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stringToRecordId } from '@syr-is/types';
import { discoveryRegistryRepository } from '$lib/repositories/discovery-registry.repository';
import { registryApiRoot } from '$lib/registry-url';
import { resolveRemoteEndpoints } from '$lib/server/resolve-remote-endpoints.server';

const ERROR_BODY_MAX_CHARS = 500;

type DirectoryRow = {
	did: string;
	provider: string;
	username: string;
	displayName: string;
	updatedAt: string;
	registryUrl: string;
};

type EnrichedDirectoryRow = DirectoryRow & {
	avatarUrl: string | null;
	bannerUrl: string | null;
};

function isHttpOrHttpsUrl(urlStr: string): boolean {
	try {
		const u = new URL(urlStr);
		return u.protocol === 'https:' || u.protocol === 'http:';
	} catch {
		return false;
	}
}

async function enrichRowWithProfileAssets(row: DirectoryRow): Promise<EnrichedDirectoryRow> {
	if (!isHttpOrHttpsUrl(row.provider)) {
		return { ...row, avatarUrl: null, bannerUrl: null };
	}
	try {
		const ep = await resolveRemoteEndpoints(row.did, row.provider, null, 6_000);
		const res = await fetch(ep.profile, {
			signal: AbortSignal.timeout(6_000),
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) {
			return { ...row, avatarUrl: null, bannerUrl: null };
		}
		const body = (await res.json()) as {
			data?: { avatar_url?: string | null; banner_url?: string | null };
		};
		const d = body.data;
		return {
			...row,
			avatarUrl: d?.avatar_url ?? null,
			bannerUrl: d?.banner_url ?? null
		};
	} catch {
		return { ...row, avatarUrl: null, bannerUrl: null };
	}
}

function parseUpdatedAtMs(iso: string): number {
	const t = Date.parse(iso);
	return Number.isNaN(t) ? 0 : t;
}

function pickDirectoryRow(a: DirectoryRow, b: DirectoryRow): DirectoryRow {
	const ta = parseUpdatedAtMs(a.updatedAt);
	const tb = parseUpdatedAtMs(b.updatedAt);
	if (tb !== ta) return tb > ta ? b : a;
	return a.registryUrl <= b.registryUrl ? a : b;
}

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

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	}
	const q = url.searchParams.get('q') ?? '';
	const limitParam = url.searchParams.get('limit');
	const parsedLimit = parseInt(limitParam ?? '20', 10);
	const limit = Math.min(50, Math.max(1, Number.isNaN(parsedLimit) ? 20 : parsedLimit));

	const userId = stringToRecordId.decode(locals.user.id);
	const registries = await discoveryRegistryRepository.findByUserId(userId);
	if (registries.length === 0) {
		return json({
			status: 'success',
			data: [],
			meta: {
				message:
					'No discovery registries configured. Add registries under Settings → Discovery to search the directory.'
			}
		});
	}

	const params = new URLSearchParams();
	if (q) params.set('q', q);
	params.set('limit', String(limit));

	const merged = new Map<string, DirectoryRow>();

	await Promise.all(
		registries.map(async (r) => {
			let base: string;
			try {
				base = registryApiRoot(r.registry_url);
			} catch (err) {
				console.debug('directory search: invalid registry URL', {
					registry_url: r.registry_url,
					err
				});
				return;
			}
			try {
				const res = await fetch(`${base}/directory/search?${params.toString()}`, {
					signal: AbortSignal.timeout(12_000)
				});
				if (!res.ok) {
					const bodySnippet = await readResponseBodyPrefix(res, ERROR_BODY_MAX_CHARS);
					console.debug('directory search: non-OK registry response', {
						registry_url: r.registry_url,
						base,
						status: res.status,
						statusText: res.statusText,
						body: bodySnippet
					});
					return;
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
				const rows = jsonBody.data ?? [];
				for (const row of rows) {
					const next: DirectoryRow = { ...row, registryUrl: base };
					const cur = merged.get(row.did);
					merged.set(row.did, cur ? pickDirectoryRow(cur, next) : next);
				}
			} catch (err) {
				console.debug('directory search registry failed', {
					registry_url: r.registry_url,
					base,
					err
				});
			}
		})
	);

	const sorted = [...merged.values()].sort((a, b) => {
		const tb = parseUpdatedAtMs(b.updatedAt);
		const ta = parseUpdatedAtMs(a.updatedAt);
		if (tb !== ta) return tb - ta;
		return a.did.localeCompare(b.did);
	});

	const limited = sorted.slice(0, limit);
	const data = await Promise.all(limited.map((row) => enrichRowWithProfileAssets(row)));

	return json({
		status: 'success',
		data
	});
};
