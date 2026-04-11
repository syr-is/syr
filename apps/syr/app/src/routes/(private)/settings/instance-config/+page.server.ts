import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { kvService } from '$lib/services/kv';
import {
	INSTANCE_CONFIG_TYPE,
	KEY_PROFILE_SYNC_ASSET_PATH,
	KEY_USERNAME_CHANGE_COOLDOWN_DAYS,
	DEFAULT_PATH,
	DEFAULT_USERNAME_COOLDOWN_DAYS,
	KEY_DEFAULT_STORAGE_LIMIT_GB,
	DEFAULT_STORAGE_LIMIT_GB,
	KEY_INSTANCE_STORAGE_CAPACITY_GB,
	KEY_INSTANCE_MEDIA_STORAGE_GB,
	INVITE_CODE_TYPE
} from '$lib/instance-config';
import { getRegistrationMode } from '$lib/instance-config';
import { instanceDiscoveryRegistryRepository } from '$lib/repositories/instance-discovery-registry.repository';
import { InviteCodeValueSchema } from '@syr-is/types';

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

	const [rawStorageLimit, rawStorageCapacity, rawMediaStorage] = await Promise.all([
		kvService.get<string>(INSTANCE_CONFIG_TYPE, KEY_DEFAULT_STORAGE_LIMIT_GB),
		kvService.get<string>(INSTANCE_CONFIG_TYPE, KEY_INSTANCE_STORAGE_CAPACITY_GB),
		kvService.get<string>(INSTANCE_CONFIG_TYPE, KEY_INSTANCE_MEDIA_STORAGE_GB)
	]);
	const defaultStorageLimitGb = rawStorageLimit ?? String(DEFAULT_STORAGE_LIMIT_GB);
	const instanceStorageCapacityGb = rawStorageCapacity ?? '';
	const instanceMediaStorageGb = rawMediaStorage ?? '';

	const inviteCodeEntries = await kvService.getByType(INVITE_CODE_TYPE);
	const inviteCodes: {
		code: string;
		created_by: string;
		max_uses: number | null;
		uses: number;
		created_at: string;
	}[] = [];
	for (const entry of inviteCodeEntries) {
		const raw = String(entry.id.id);
		const prefix = `${INVITE_CODE_TYPE}:`;
		const code = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
		const parsed = InviteCodeValueSchema.safeParse(entry.value);
		if (!parsed.success) {
			console.warn(`[instance-config] Skipping malformed invite code entry ${raw}`, parsed.error);
			continue;
		}
		inviteCodes.push({
			code,
			created_by: parsed.data.created_by,
			max_uses: parsed.data.max_uses,
			uses: parsed.data.uses,
			created_at: parsed.data.created_at
		});
	}

	const instanceDiscoveryRows = await instanceDiscoveryRegistryRepository.findAll();

	return {
		user,
		profileSyncAssetPath,
		usernameCooldownDays,
		registrationMode,
		defaultStorageLimitGb,
		instanceStorageCapacityGb,
		instanceMediaStorageGb,
		inviteCodes,
		instanceDiscoveryRegistries: instanceDiscoveryRows.map((r) => ({
			id: r.id.toString(),
			registryUrl: r.registry_url
		}))
	};
};
