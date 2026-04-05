import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getRegistrationMode } from '$lib/instance-config';

export const load: PageServerLoad = async () => {
	const registrationMode = await getRegistrationMode();
	if (registrationMode === 'closed') {
		throw redirect(303, '/login');
	}
	return { registrationMode };
};
