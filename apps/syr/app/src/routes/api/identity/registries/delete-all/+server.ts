import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stringToRecordId } from '@syr-is/types';
import { identityController } from '$lib/controllers/identity.controller';
import { registryRepository } from '$lib/repositories/registry.repository';
import { outboxRepository } from '$lib/repositories/outbox.repository';
import { config } from '$lib/config';

/**
 * POST /api/identity/registries/delete-all
 * As custodian, delete this identity from ALL registries.
 * Enqueues deletion jobs via the outbox for each registry.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const identity = await identityController.getIdentity(locals.user.id);
	if (!identity) throw error(404, 'No identity found');

	const registries = await registryRepository.findByDid(identity.did);
	if (registries.length === 0) {
		return json({ status: 'ok', message: 'No registries to delete from.' });
	}

	// Enqueue delete jobs for each registry
	for (const reg of registries) {
		await outboxRepository.enqueue({
			type: 'registry_sync',
			payload: {
				action: 'delete',
				did: identity.did,
				registryUrl: reg.registry_url,
				provider: config.PUBLIC_URL
			},
			userId: stringToRecordId.decode(locals.user.id)
		});
		await registryRepository.removeRegistry(reg.id);
	}

	return json({
		status: 'ok',
		message: `Queued deletion from ${registries.length} registries.`
	});
};
