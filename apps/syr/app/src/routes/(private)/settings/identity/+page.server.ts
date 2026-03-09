import type { PageServerLoad } from './$types';
import { identityController } from '$lib/controllers/identity.controller';
import { registryRepository } from '$lib/repositories/registry.repository';
import { outboxRepository } from '$lib/repositories/outbox.repository';
import { redirect } from '@sveltejs/kit';
import { stringToRecordId } from '@syr-is/types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	if (!locals.user) {
		throw redirect(302, '/login');
	}

	const parentData = await parent();
	const identityContext = parentData.identityContext;
	const hasIdentity = identityContext?.hasIdentity ?? false;
	const did = identityContext?.did ?? null;
	const userId = stringToRecordId.decode(locals.user.id);

	const delegatedKeys = hasIdentity
		? await identityController.getDelegatedKeys(locals.user.id)
		: [];

	const registries = did ? await registryRepository.findByDid(did) : [];
	const outboxJobs = hasIdentity
		? await outboxRepository.findActiveByUserAndType(userId, 'registry_sync')
		: [];

	return {
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
