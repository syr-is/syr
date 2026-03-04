import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { kvService } from '$lib/services/kv';
import {
	INSTANCE_CONFIG_TYPE,
	KEY_PROFILE_SYNC_ASSET_PATH,
	KEY_USERNAME_CHANGE_COOLDOWN_DAYS,
	DEFAULT_PATH,
	DEFAULT_USERNAME_COOLDOWN_DAYS
} from '$lib/instance-config';

export const load: PageServerLoad = async ({ parent }) => {
	const { user } = await parent();
	if (user?.role !== 'ADMIN') {
		throw redirect(303, '/settings/profile');
	}

	const profileSyncAssetPath =
		(await kvService.get<string>(INSTANCE_CONFIG_TYPE, KEY_PROFILE_SYNC_ASSET_PATH)) ??
		DEFAULT_PATH.join('/');
	const usernameCooldownDays =
		(await kvService.get<string>(INSTANCE_CONFIG_TYPE, KEY_USERNAME_CHANGE_COOLDOWN_DAYS)) ??
		String(DEFAULT_USERNAME_COOLDOWN_DAYS);

	return {
		user,
		profileSyncAssetPath,
		usernameCooldownDays
	};
};
