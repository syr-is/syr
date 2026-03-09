import type { PageServerLoad } from './$types';
import { getIdentityContext } from '$lib/server/identity-context';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	const ctx = user ? await getIdentityContext(user.id, locals) : null;

	return {
		user,
		hasIdentity: ctx?.hasIdentity ?? false,
		did: ctx?.did ?? null
	};
};
