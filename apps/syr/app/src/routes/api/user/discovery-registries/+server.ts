import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stringToRecordId } from '@syr-is/types';
import { discoveryRegistryRepository } from '$lib/repositories/discovery-registry.repository';

/**
 * GET /api/user/discovery-registries
 * List registries this account uses for directory search and follow discovery (not publication).
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const userId = stringToRecordId.decode(locals.user.id);
	const registries = await discoveryRegistryRepository.findByUserId(userId);
	return json({ data: registries });
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
