import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { kvService } from '$lib/services/kv';
import {
	INSTANCE_CONFIG_TYPE,
	KEY_PROFILE_SYNC_ASSET_PATH,
	KEY_USERNAME_CHANGE_COOLDOWN_DAYS,
	KEY_REGISTRATION_MODE,
	KEY_DEFAULT_STORAGE_LIMIT_GB,
	KEY_INSTANCE_STORAGE_CAPACITY_GB,
	DEFAULT_PATH
} from '$lib/instance-config';
import { RegistrationModeSchema } from '@syr-is/types';

const INSTANCE_CONFIG_KEYS = [
	KEY_PROFILE_SYNC_ASSET_PATH,
	KEY_USERNAME_CHANGE_COOLDOWN_DAYS,
	KEY_REGISTRATION_MODE,
	KEY_DEFAULT_STORAGE_LIMIT_GB,
	KEY_INSTANCE_STORAGE_CAPACITY_GB
] as const;
type AllowedKey = (typeof INSTANCE_CONFIG_KEYS)[number];

function isAllowedKey(key: string): key is AllowedKey {
	return INSTANCE_CONFIG_KEYS.includes(key as AllowedKey);
}

/** Validate path value: slash-separated segments, alphanumeric + hyphen/underscore, no .. */
function validatePathValue(val: string): string {
	const trimmed = val.trim();
	if (!trimmed) return DEFAULT_PATH.join('/');
	const segments = trimmed
		.split('/')
		.map((s) => s.trim())
		.filter(Boolean);
	if (segments.some((s) => s === '..' || !/^[a-zA-Z0-9_-]+$/.test(s))) {
		throw new Error('Invalid path: segments must be alphanumeric, hyphen, or underscore only');
	}
	return segments.join('/');
}

/** Validate cooldown days: integer 1–365 */
function validateCooldownDaysValue(val: string): string {
	const n = parseInt(val.trim(), 10);
	if (isNaN(n) || n < 1 || n > 365) {
		throw new Error('Value must be an integer between 1 and 365');
	}
	return String(n);
}

/** Validate storage limit in GB: positive number */
function validateStorageLimitGb(val: string): string {
	const n = parseFloat(val.trim());
	if (!Number.isFinite(n) || n <= 0) {
		throw new Error('Value must be a finite positive number (in GB)');
	}
	return String(n);
}

/** Validate registration mode: open | invite_only | closed */
function validateRegistrationMode(val: string): string {
	const result = RegistrationModeSchema.safeParse(val.trim());
	if (!result.success) {
		throw new Error('Value must be one of: open, invite_only, closed');
	}
	return result.data;
}

const ADMIN_ONLY_KEYS: readonly string[] = [
	KEY_REGISTRATION_MODE,
	KEY_DEFAULT_STORAGE_LIMIT_GB,
	KEY_INSTANCE_STORAGE_CAPACITY_GB
];

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}
	const key = params.key;
	if (!isAllowedKey(key)) {
		throw error(404, { code: 'NOT_FOUND', message: 'Unknown instance config key' });
	}
	if (ADMIN_ONLY_KEYS.includes(key) && locals.user.role !== 'ADMIN') {
		throw error(403, { code: 'FORBIDDEN', message: 'Admin access required' });
	}
	const value = await kvService.get<string>(INSTANCE_CONFIG_TYPE, key);
	return json({ value: value ?? null });
};

const PatchBodySchema = z.object({
	value: z.string().min(1)
});

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}
	if (locals.user.role !== 'ADMIN') {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'Only instance administrators can update instance config'
		});
	}
	const key = params.key;
	if (!isAllowedKey(key)) {
		throw error(404, { code: 'NOT_FOUND', message: 'Unknown instance config key' });
	}
	let body: z.infer<typeof PatchBodySchema>;
	try {
		body = PatchBodySchema.parse(await request.json());
	} catch {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid request body' });
	}
	let value: string;
	try {
		if (key === KEY_USERNAME_CHANGE_COOLDOWN_DAYS) {
			value = validateCooldownDaysValue(body.value);
		} else if (key === KEY_REGISTRATION_MODE) {
			value = validateRegistrationMode(body.value);
		} else if (key === KEY_DEFAULT_STORAGE_LIMIT_GB || key === KEY_INSTANCE_STORAGE_CAPACITY_GB) {
			value = validateStorageLimitGb(body.value);
		} else {
			value = validatePathValue(body.value);
		}
	} catch (e) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: e instanceof Error ? e.message : 'Invalid value'
		});
	}
	await kvService.set(INSTANCE_CONFIG_TYPE, key, value);
	return json({ value });
};
