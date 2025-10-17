import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// User is already authenticated due to (private) route group
	if (!locals.user) {
		await goto(resolve('/login'));
		return;
	}

	return {
		user: locals.user
	};
};
