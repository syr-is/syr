import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// Auto-redirect to profile settings
	throw redirect(302, '/settings/profile');
};
