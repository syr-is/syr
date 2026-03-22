import type { PageServerLoad } from './$types';
import { discoveryRegistryRepository } from '$lib/repositories/discovery-registry.repository';
import { registryRepository } from '$lib/repositories/registry.repository';
import { identityController } from '$lib/controllers/identity.controller';
import { redirect } from '@sveltejs/kit';
import { stringToRecordId } from '@syr-is/types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/login');
	}

	const userId = stringToRecordId.decode(locals.user.id);
	const discovery = await discoveryRegistryRepository.findByUserId(userId);

	const identity = await identityController.getIdentity(locals.user.id);
	const publication = identity != null ? await registryRepository.findByDid(identity.did) : [];

	return {
		discoveryRegistries: discovery.map((r) => ({
			id: String(r.id),
			registryUrl: r.registry_url,
			createdAt: r.created_at
		})),
		publicationRegistryUrls: publication.map((r) => r.registry_url)
	};
};
