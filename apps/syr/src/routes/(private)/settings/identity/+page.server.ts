import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { PageServerLoad } from './$types';
import { identityController } from '$lib/controllers/identity.controller';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		await goto(resolve('/login'));
		return;
	}

	const hasIdentity = await identityController.hasIdentity(locals.user.id);
	const identity = hasIdentity ? await identityController.getIdentity(locals.user.id) : null;
	const delegatedKeys = hasIdentity ? await identityController.getDelegatedKeys(locals.user.id) : [];

	return {
		hasIdentity,
		did: identity?.did ?? null,
		delegatedKeys
	};
};
