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

	const [capacity, defaultLimit, mediaReservation, usage, overrides, userCount] = await Promise.all(
		[
			getInstanceStorageCapacityBytes(),
			getDefaultStorageLimitBytes(),
			getInstanceMediaStorageBytes(),
			kvService.aggregateByType(KV_USAGE_TYPE, 'bytes_used'),
			kvService.aggregateByType(KV_LIMIT_TYPE, 'bytes_limit'),
			userRepository.count()
		]
	);

	// Totals are summed in the database (math::sum), so we never transfer per-user rows.
	const totalUsed = usage.sum;
	// Everyone starts on the default limit; each override shifts the total by its
	// delta from the default. (An override left behind for a deleted user would be
	// counted; clearing overrides on deletion avoids that.)
	const totalAllocated = userCount * defaultLimit + overrides.sum - overrides.count * defaultLimit;

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
