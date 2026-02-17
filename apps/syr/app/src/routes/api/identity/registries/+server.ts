import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stringToRecordId } from '@syr-is/types';
import { identityController } from '$lib/controllers/identity.controller';
import { registryRepository } from '$lib/repositories/registry.repository';
import { outboxRepository } from '$lib/repositories/outbox.repository';
import { config } from '$lib/config';

/**
 * GET /api/identity/registries
 * List the user's configured registries.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const identity = await identityController.getIdentity(locals.user.id);
	if (!identity) throw error(404, 'No identity found');

	const registries = await registryRepository.findByDid(identity.did);
	return json({ data: registries });
};

/**
 * POST /api/identity/registries
 * Add a new registry URL and enqueue a sync job via the outbox.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const registryUrl = body.registryUrl?.trim();

	if (!registryUrl) {
		throw error(400, 'registryUrl is required');
	}

	// Validate URL format
	try {
		new URL(registryUrl);
	} catch {
		throw error(400, 'Invalid URL format');
	}

	const identity = await identityController.getIdentity(locals.user.id);
	if (!identity) throw error(404, 'No identity found');

	// Check for duplicate
	const existing = await registryRepository.findByDidAndUrl(identity.did, registryUrl);
	if (existing) {
		throw error(409, 'Registry already added');
	}

	// Add registry entry
	await registryRepository.addRegistry(identity.did, registryUrl);

	// Enqueue outbox job
	await outboxRepository.enqueue({
		type: 'registry_sync',
		payload: {
			action: 'update',
			did: identity.did,
			registryUrl,
			provider: config.PUBLIC_URL
		},
		userId: stringToRecordId.decode(locals.user.id)
	});

	return json({ status: 'ok', message: 'Registry added. Sync will happen shortly.' });
};
