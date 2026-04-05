import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { kvService } from '$lib/services/kv';
import {
	INSTANCE_CONFIG_TYPE,
	KEY_PROFILE_SYNC_ASSET_PATH,
	KEY_USERNAME_CHANGE_COOLDOWN_DAYS,
	DEFAULT_PATH,
	DEFAULT_USERNAME_COOLDOWN_DAYS,
	INVITE_CODE_TYPE
} from '$lib/instance-config';
import { getRegistrationMode } from '$lib/instance-config';
import { instanceDiscoveryRegistryRepository } from '$lib/repositories/instance-discovery-registry.repository';
import type { InviteCodeValue } from '@syr-is/types';

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

	const registrationMode = await getRegistrationMode();

	const inviteCodeEntries = await kvService.getByType(INVITE_CODE_TYPE);
	const inviteCodes = inviteCodeEntries.map((entry) => {
		const raw = String(entry.id.id);
		const prefix = `${INVITE_CODE_TYPE}:`;
		const code = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
		const value = entry.value as InviteCodeValue;
		return {
			code,
			created_by: value.created_by,
			max_uses: value.max_uses,
			uses: value.uses,
			created_at: value.created_at
		};
	});

	const instanceDiscoveryRows = await instanceDiscoveryRegistryRepository.findAll();

	return {
		user,
		profileSyncAssetPath,
		usernameCooldownDays,
		registrationMode,
		inviteCodes,
		instanceDiscoveryRegistries: instanceDiscoveryRows.map((r) => ({
			id: r.id.toString(),
			registryUrl: r.registry_url
		}))
	};
};
