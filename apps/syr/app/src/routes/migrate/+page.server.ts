import type { PageServerLoad } from './$types';
import { identityController } from '$lib/controllers/identity.controller';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	const hasIdentity = user ? await identityController.hasIdentity(user.id) : false;
	const did =
		hasIdentity && user ? ((await identityController.getIdentity(user.id))?.did ?? null) : null;

	return {
		user,
		hasIdentity,
		did
	};
};
