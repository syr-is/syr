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

	const [capacity, defaultLimit, mediaReservation, usageEntries, limitEntries, userCount] =
		await Promise.all([
			getInstanceStorageCapacityBytes(),
			getDefaultStorageLimitBytes(),
			getInstanceMediaStorageBytes(),
			kvService.getByType(KV_USAGE_TYPE),
			kvService.getByType(KV_LIMIT_TYPE),
			userRepository.count()
		]);

	// Total used = sum of every user's pre-computed usage entry.
	let totalUsed = 0;
	for (const entry of usageEntries) {
		const val = entry.value as { bytes_used?: number };
		totalUsed += val.bytes_used ?? 0;
	}

	// Total allocated = (everyone on the default) + per-override delta.
	// Avoids fetching all users: start from userCount × default, then adjust by
	// each override's difference from the default. (An override left behind for a
	// deleted user would be counted; clearing overrides on deletion avoids that.)
	let totalAllocated = userCount * defaultLimit;
	for (const entry of limitEntries) {
		const val = entry.value as { bytes_limit?: number };
		if (typeof val.bytes_limit === 'number' && val.bytes_limit > 0) {
			totalAllocated += val.bytes_limit - defaultLimit;
		}
	}

	return json({
		status: 'success',
		data: {
			capacity,
			total_used: totalUsed,
			total_allocated: totalAllocated,
			media_reservation: mediaReservation,
			default_limit: defaultLimit,
			user_count: userCount
		}
	});
};
