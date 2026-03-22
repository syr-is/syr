import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stringToRecordId } from '@syr-is/types';
import { discoveryRegistryRepository } from '$lib/repositories/discovery-registry.repository';

/**
 * DELETE /api/user/discovery-registries/[registryId]
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const idStr = decodeURIComponent(params.registryId);
	const registryId = idStr.includes(':')
		? stringToRecordId.decode(idStr)
		: stringToRecordId.decode(`discovery_registry:${idStr}`);

	const registry = await discoveryRegistryRepository.findById(registryId);
	if (!registry) throw error(404, 'Registry not found');

	const userId = stringToRecordId.decode(locals.user.id);
	if (registry.user_id.toString() !== userId.toString()) {
		throw error(403, 'Not authorized');
	}

	await discoveryRegistryRepository.remove(registryId);
	return json({ status: 'ok', message: 'Discovery registry removed.' });
};
