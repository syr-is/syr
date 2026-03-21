import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityController } from '$lib/controllers/identity.controller';
import { registryRepository } from '$lib/repositories/registry.repository';
import { registryApiRoot } from '$lib/registry-url';

const ERROR_BODY_MAX_CHARS = 500;

type DirectoryRow = {
	did: string;
	provider: string;
	username: string;
	displayName: string;
	updatedAt: string;
	registryUrl: string;
};

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

	const identity = await identityController.getIdentity(locals.user.id);
	if (!identity) {
		throw error(400, {
			code: 'IDENTITY_REQUIRED',
			message: 'Configure an identity and registries to search'
		});
	}

	const registries = await registryRepository.findByDid(identity.did);
	if (registries.length === 0) {
		return json({
			status: 'success',
			data: [],
			meta: { message: 'No registries configured' }
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

	return json({
		status: 'success',
		data: sorted.slice(0, limit)
	});
};
