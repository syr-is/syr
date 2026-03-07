import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getIdentityContext } from '$lib/server/identity-context';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(303, '/login');
	}

	const ctx = await getIdentityContext(locals.user.id);
	const identityContext = {
		hasIdentity: ctx.hasIdentity,
		hasAegis: ctx.hasAegis,
		did: ctx.did
	};

	return {
		user: locals.user,
		identityContext
	};
};
