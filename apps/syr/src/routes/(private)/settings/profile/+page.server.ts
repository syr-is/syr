import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// User is already authenticated due to (private) route group
	if (!locals.user) {
		throw new Error('User not authenticated');
	}

	return {
		user: locals.user
	};
};
