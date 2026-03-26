import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stringToRecordId } from '@syr-is/types';
import { instanceDiscoveryRegistryRepository } from '$lib/repositories/instance-discovery-registry.repository';

/**
 * DELETE /api/instance/discovery-registries/[registryId]
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}
	if (locals.user.role !== 'ADMIN') {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'Only instance administrators can manage instance discovery'
		});
	}

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
			: stringToRecordId.decode(`instance_discovery_registry:${idStr}`);
	} catch {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid registry id' });
	}

	const registry = await instanceDiscoveryRegistryRepository.findById(registryId);
	if (!registry) {
		throw error(404, { code: 'NOT_FOUND', message: 'Registry not found' });
	}

	const removed = await instanceDiscoveryRegistryRepository.remove(registryId);
	if (!removed) {
		throw error(404, { code: 'NOT_FOUND', message: 'Registry not found' });
	}
	return json({ status: 'success', message: 'Instance discovery registry removed.' });
};
