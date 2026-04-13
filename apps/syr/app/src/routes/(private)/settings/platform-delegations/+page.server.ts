import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { platformDelegationController } from '$lib/controllers/platform-delegation.controller';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(303, '/login');
	}

	const delegations = await platformDelegationController.getDelegationsForUser(locals.user.id);

	return { delegations };
};
