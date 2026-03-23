import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stringToRecordId } from '@syr-is/types';
import { discoveryRegistryRepository } from '$lib/repositories/discovery-registry.repository';

/**
 * DELETE /api/user/discovery-registries/[registryId]
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	let idStr: string;
	try {
		idStr = decodeURIComponent(params.registryId);
	} catch {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid registry id' });
	}
	let registryId;
	try {
		registryId = idStr.includes(':')
			? stringToRecordId.decode(idStr)
			: stringToRecordId.decode(`discovery_registry:${idStr}`);
	} catch {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid registry id' });
	}

	const registry = await discoveryRegistryRepository.findById(registryId);
	if (!registry) throw error(404, 'Registry not found');

	const userId = stringToRecordId.decode(locals.user.id);
	if (registry.user_id.toString() !== userId.toString()) {
		throw error(403, 'Not authorized');
	}

	const removed = await discoveryRegistryRepository.remove(registryId);
	if (!removed) {
		throw error(404, { code: 'NOT_FOUND', message: 'Registry not found' });
	}
	return json({ status: 'ok', message: 'Discovery registry removed.' });
};
