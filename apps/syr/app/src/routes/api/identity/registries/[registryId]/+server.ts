import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityController } from '$lib/controllers/identity.controller';
import { registryRepository } from '$lib/repositories/registry.repository';
import { outboxRepository } from '$lib/repositories/outbox.repository';
import { config } from '$lib/config';
import { stringToRecordId } from '@syr-is/types';

/**
 * DELETE /api/identity/registries/[registryId]
 * Remove a registry and enqueue a deletion job via the outbox.
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const registryId = stringToRecordId.decode(`identity_registry:${params.registryId}`);
	const registry = await registryRepository.findById(registryId);

	if (!registry) throw error(404, 'Registry not found');

	const identity = await identityController.getIdentity(locals.user.id);
	if (!identity || identity.did !== registry.identity_did) {
		throw error(403, 'Not authorized');
	}

	// Enqueue outbox job to delete from registry
	await outboxRepository.enqueue({
		type: 'registry_sync',
		payload: {
			action: 'delete',
			did: identity.did,
			registryUrl: registry.registry_url,
			provider: config.PUBLIC_URL
		},
		userId: stringToRecordId.decode(locals.user.id)
	});

	// Remove local registry entry
	await registryRepository.removeRegistry(registryId);

	return json({ status: 'ok', message: 'Registry removal queued.' });
};
