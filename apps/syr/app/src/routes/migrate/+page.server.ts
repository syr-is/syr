import type { PageServerLoad } from './$types';
import { identityController } from '$lib/controllers/identity.controller';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	const identity = user ? await identityController.getIdentity(user.id) : null;
	const hasIdentity = identity != null;
	const did = identity?.did ?? null;

	return {
		user,
		hasIdentity,
		did
	};
};
