import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityController } from '$lib/controllers/identity.controller';
import { registryRepository } from '$lib/repositories/registry.repository';
import { registryApiRoot } from '$lib/registry-url';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'AUTHENTICATION_ERROR', message: 'Unauthorized' });
	}
	const q = url.searchParams.get('q') ?? '';
	const limit = Math.min(
		50,
		Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20)
	);

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

	const merged = new Map<
		string,
		{
			did: string;
			provider: string;
			username: string;
			displayName: string;
			updatedAt: string;
			registryUrl: string;
		}
	>();

	await Promise.all(
		registries.map(async (r) => {
			const base = registryApiRoot(r.registry_url);
			try {
				const res = await fetch(`${base}/directory/search?${params.toString()}`, {
					signal: AbortSignal.timeout(12_000)
				});
				if (!res.ok) return;
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
					if (!merged.has(row.did)) {
						merged.set(row.did, { ...row, registryUrl: base });
					}
				}
			} catch {
				// ignore per-registry errors
			}
		})
	);

	return json({
		status: 'success',
		data: [...merged.values()]
	});
};
