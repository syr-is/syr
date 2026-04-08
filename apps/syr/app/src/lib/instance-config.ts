import { kvService } from '$lib/services/kv';
import type { RegistrationMode } from '@syr-is/types';

const INSTANCE_CONFIG_TYPE = 'instance_config';
const KEY_PROFILE_SYNC_ASSET_PATH = 'default_profile_sync_asset_upload_path';
const KEY_USERNAME_CHANGE_COOLDOWN_DAYS = 'username_change_cooldown_days';
const KEY_REGISTRATION_MODE = 'registration_mode';
const DEFAULT_PATH = ['me', 'profile', 'public'];
const DEFAULT_USERNAME_COOLDOWN_DAYS = 7;
const DEFAULT_REGISTRATION_MODE: RegistrationMode = 'open';
const INVITE_CODE_TYPE = 'invite_code';
const KEY_DEFAULT_STORAGE_LIMIT_GB = 'default_storage_limit_gb';
const DEFAULT_STORAGE_LIMIT_GB = 5;

/**
 * Get the profile sync asset upload path from instance config.
 * Path is relative to uploads/{did}/. Returns folder name segments.
 * Default: ['me', 'profile', 'public'] when unset or invalid.
 */
export async function getProfileSyncAssetUploadPath(): Promise<string[]> {
	const val = await kvService.get<string>(INSTANCE_CONFIG_TYPE, KEY_PROFILE_SYNC_ASSET_PATH);
	if (typeof val === 'string' && val.trim()) {
		const segments = val
			.split('/')
			.map((s) => s.trim())
			.filter(Boolean);
		if (segments.length > 0 && segments.every((s) => /^[a-zA-Z0-9_-]+$/.test(s))) {
			return segments;
		}
	}
	return DEFAULT_PATH;
}

/**
 * Get the number of days that must pass before a user can change their username again.
 * Default: 7 when unset or invalid.
 */
export async function getUsernameChangeCooldownDays(): Promise<number> {
	const val = await kvService.get<string>(INSTANCE_CONFIG_TYPE, KEY_USERNAME_CHANGE_COOLDOWN_DAYS);
	if (val != null) {
		const n = parseInt(String(val), 10);
		if (!isNaN(n) && n >= 1 && n <= 365) return n;
	}
	return DEFAULT_USERNAME_COOLDOWN_DAYS;
}

/**
 * Get the registration mode for this instance.
 * Default: 'open' when unset or invalid.
 */
export async function getRegistrationMode(): Promise<RegistrationMode> {
	const val = await kvService.get<string>(INSTANCE_CONFIG_TYPE, KEY_REGISTRATION_MODE);
	if (val === 'open' || val === 'invite_only' || val === 'closed') return val;
	return DEFAULT_REGISTRATION_MODE;
}

/**
 * Get the instance default storage limit in bytes.
 * Default: 5GB when unset or invalid.
 */
export async function getDefaultStorageLimitBytes(): Promise<number> {
	const val = await kvService.get<string>(INSTANCE_CONFIG_TYPE, KEY_DEFAULT_STORAGE_LIMIT_GB);
	if (val != null) {
		const n = parseFloat(String(val));
		if (!isNaN(n) && n > 0) return Math.round(n * 1024 * 1024 * 1024);
	}
	return DEFAULT_STORAGE_LIMIT_GB * 1024 * 1024 * 1024;
}

export {
	INSTANCE_CONFIG_TYPE,
	KEY_PROFILE_SYNC_ASSET_PATH,
	KEY_USERNAME_CHANGE_COOLDOWN_DAYS,
	KEY_REGISTRATION_MODE,
	KEY_DEFAULT_STORAGE_LIMIT_GB,
	DEFAULT_PATH,
	DEFAULT_USERNAME_COOLDOWN_DAYS,
	DEFAULT_REGISTRATION_MODE,
	DEFAULT_STORAGE_LIMIT_GB,
	INVITE_CODE_TYPE
};
