import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stringToRecordId } from '@syr-is/types';
import { normalizeRegistryUrl } from '$lib/registry-url';
import { discoveryRegistryRepository } from '$lib/repositories/discovery-registry.repository';
import { instanceDiscoveryRegistryRepository } from '$lib/repositories/instance-discovery-registry.repository';

/**
 * GET /api/user/discovery-registries
 * List registries for resolution: user's list first, then instance-wide, deduped by canonical URL.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const userId = stringToRecordId.decode(locals.user.id);
	const userRows = await discoveryRegistryRepository.findByUserId(userId);
	const instanceRows = await instanceDiscoveryRegistryRepository.findAll();

	const seen = new Set<string>();
	const merged: { registry_url: string }[] = [];

	for (const r of userRows) {
		try {
			const n = normalizeRegistryUrl(r.registry_url);
			if (!seen.has(n)) {
				seen.add(n);
				merged.push({ registry_url: n });
			}
		} catch {
			/* skip invalid stored URL */
		}
	}
	for (const r of instanceRows) {
		try {
			const n = normalizeRegistryUrl(r.registry_url);
			if (!seen.has(n)) {
				seen.add(n);
				merged.push({ registry_url: n });
			}
		} catch {
			/* skip */
		}
	}

	return json({ data: merged });
};

/**
 * POST /api/user/discovery-registries
 * Add a discovery registry URL (no outbox / sync).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	let body: unknown;
	try {
		body = await request.json();
	} catch (e) {
		if (e instanceof SyntaxError) {
			throw error(400, { code: 'BAD_REQUEST', message: 'Invalid JSON body' });
		}
		throw e;
	}
	const registryUrl =
		body != null && typeof body === 'object' && 'registryUrl' in body
			? String((body as { registryUrl?: unknown }).registryUrl ?? '').trim()
			: '';

	if (!registryUrl) {
		throw error(400, 'registryUrl is required');
	}

	try {
		new URL(registryUrl);
	} catch {
		throw error(400, 'Invalid URL format');
	}

	const userId = stringToRecordId.decode(locals.user.id);
	const existing = await discoveryRegistryRepository.findByUserIdAndUrl(userId, registryUrl);
	if (existing) {
		throw error(409, 'Registry already added');
	}

	await discoveryRegistryRepository.add(userId, registryUrl);
	return json({ status: 'ok', message: 'Discovery registry added.' });
};
