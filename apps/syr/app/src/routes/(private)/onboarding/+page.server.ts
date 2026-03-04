import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

function needsOnboarding(displayName: string | null | undefined): boolean {
	return !!displayName && /^il_[a-zA-Z0-9_-]+_\w{6}$/.test(displayName);
}

export const load: PageServerLoad = async ({ parent }) => {
	const { user } = await parent();
	const profile = user?.profile;
	if (profile && needsOnboarding(profile.display_name)) {
		throw redirect(302, '/settings/sync-syner');
	}
	return { user };
};
