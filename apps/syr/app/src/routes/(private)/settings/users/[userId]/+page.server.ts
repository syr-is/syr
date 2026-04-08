import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params }) => {
	const { user } = await parent();
	if (user?.role !== 'ADMIN') {
		throw redirect(303, '/settings/profile');
	}

	return { userId: params.userId };
};
