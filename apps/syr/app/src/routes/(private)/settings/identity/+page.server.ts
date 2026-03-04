import type { PageServerLoad } from './$types';
import { identityController } from '$lib/controllers/identity.controller';
import { registryRepository } from '$lib/repositories/registry.repository';
import { outboxRepository } from '$lib/repositories/outbox.repository';
import { redirect } from '@sveltejs/kit';
import { stringToRecordId } from '@syr-is/types';
import { buildAegisBundleFromIdentity } from '$lib/utils/aegis-bundle.server';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/login');
	}

	const userId = stringToRecordId.decode(locals.user.id);
	const hasIdentity = await identityController.hasIdentity(locals.user.id);
	const identity = hasIdentity ? await identityController.getIdentity(locals.user.id) : null;
	const delegatedKeys = hasIdentity
		? await identityController.getDelegatedKeys(locals.user.id)
		: [];

	// Load registries and outbox jobs if identity exists
	const registries = identity ? await registryRepository.findByDid(identity.did) : [];
	const outboxJobs = hasIdentity
		? await outboxRepository.findActiveByUserAndType(userId, 'registry_sync')
		: [];

	return {
		hasIdentity,
		hasAegis: identity ? !!buildAegisBundleFromIdentity(identity) : false,
		did: identity?.did ?? null,
		delegatedKeys,
		registries: registries.map((r) => ({
			id: String(r.id),
			registryUrl: r.registry_url,
			status: r.status,
			lastSyncedAt: r.last_synced_at
		})),
		outboxJobs: outboxJobs.map((j) => ({
			id: String(j.id),
			type: j.type,
			status: j.status,
			attempts: j.attempts,
			maxAttempts: j.max_attempts,
			lastError: j.last_error,
			payload: j.payload as Record<string, string>,
			createdAt: j.created_at,
			updatedAt: j.updated_at
		}))
	};
};
