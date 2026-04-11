import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kvService } from '$lib/services/kv';
import {
	getDefaultStorageLimitBytes,
	getInstanceStorageCapacityBytes,
	getInstanceMediaStorageBytes
} from '$lib/instance-config';
import { userRepository } from '$lib/repositories/user.repository';

const KV_USAGE_TYPE = 'file_store_usage';
const KV_LIMIT_TYPE = 'file_store_limit_override';
const MAX_USER_FETCH_LIMIT = 10000;

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}
	if (locals.user.role !== 'ADMIN') {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'Only instance administrators can view storage overview'
		});
	}

	const [capacity, defaultLimit, mediaReservation, usageEntries, limitEntries, usersResult] =
		await Promise.all([
			getInstanceStorageCapacityBytes(),
			getDefaultStorageLimitBytes(),
			getInstanceMediaStorageBytes(),
			kvService.getByType(KV_USAGE_TYPE),
			kvService.getByType(KV_LIMIT_TYPE),
			userRepository.findManyWithSearch({ limit: MAX_USER_FETCH_LIMIT, offset: 0 })
		]);

	// Build usage map: userId string → bytes_used
	const usageMap = new Map<string, number>();
	for (const entry of usageEntries) {
		const raw = String(entry.id.id);
		const prefix = `${KV_USAGE_TYPE}:`;
		const key = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
		const val = entry.value as { bytes_used?: number };
		usageMap.set(key, val.bytes_used ?? 0);
	}

	// Build limit override map: userId string → bytes_limit
	const limitMap = new Map<string, number>();
	for (const entry of limitEntries) {
		const raw = String(entry.id.id);
		const prefix = `${KV_LIMIT_TYPE}:`;
		const key = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
		const val = entry.value as { bytes_limit?: number };
		if (typeof val.bytes_limit === 'number' && val.bytes_limit > 0) {
			limitMap.set(key, val.bytes_limit);
		}
	}

	// Build per-user breakdown
	let totalUsed = 0;
	let totalAllocated = 0;
	const users = usersResult.data.map((u) => {
		const uid = u.id.toString();
		const bytesUsed = usageMap.get(uid) ?? 0;
		const bytesLimit = limitMap.get(uid) ?? defaultLimit;
		totalUsed += bytesUsed;
		totalAllocated += bytesLimit;
		return {
			id: uid,
			username: u.username,
			bytes_used: bytesUsed,
			bytes_limit: bytesLimit
		};
	});

	// Sort by usage descending
	users.sort((a, b) => b.bytes_used - a.bytes_used);

	return json({
		status: 'success',
		data: {
			capacity,
			total_used: totalUsed,
			total_allocated: totalAllocated,
			media_reservation: mediaReservation,
			default_limit: defaultLimit,
			user_count: users.length,
			users
		}
	});
};
