import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { kvService } from '$lib/services/kv';
import { getDefaultStorageLimitBytes } from '$lib/instance-config';
import { userRepository } from '$lib/repositories/user.repository';

const KV_USAGE_TYPE = 'file_store_usage';
const KV_LIMIT_TYPE = 'file_store_limit_override';

const QuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	size: z.coerce.number().int().min(1).max(100).default(10)
});

/**
 * Per-user storage breakdown, sorted by usage descending and paginated.
 * Only users with a usage record are listed (i.e. those who have uploaded).
 * Usernames are fetched only for the requested page, so this never loads all users.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}
	if (locals.user.role !== 'ADMIN') {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'Only instance administrators can view storage usage'
		});
	}

	const parsed = QuerySchema.safeParse({
		page: url.searchParams.get('page') ?? undefined,
		size: url.searchParams.get('size') ?? undefined
	});
	if (!parsed.success) {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid query parameters' });
	}

	const { page, size } = parsed.data;
	const offset = (page - 1) * size;

	const [defaultLimit, usageEntries, limitEntries] = await Promise.all([
		getDefaultStorageLimitBytes(),
		kvService.getByType(KV_USAGE_TYPE),
		kvService.getByType(KV_LIMIT_TYPE)
	]);

	// Per-user limit overrides keyed by user record-id string.
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

	const rows = usageEntries.map((entry) => {
		const raw = String(entry.id.id);
		const prefix = `${KV_USAGE_TYPE}:`;
		const key = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
		const val = entry.value as { bytes_used?: number };
		return {
			id: key,
			bytes_used: val.bytes_used ?? 0,
			bytes_limit: limitMap.get(key) ?? defaultLimit
		};
	});
	rows.sort((a, b) => b.bytes_used - a.bytes_used);

	const total = rows.length;
	const pageRows = rows.slice(offset, offset + size);

	const usernameMap = await userRepository.findUsernamesByIds(pageRows.map((r) => r.id));

	const data = pageRows.map((r) => ({
		id: r.id,
		username: usernameMap.get(r.id) ?? r.id,
		bytes_used: r.bytes_used,
		bytes_limit: r.bytes_limit
	}));

	return json({
		status: 'success',
		data,
		pagination: { limit: size, offset, total, has_more: offset + size < total }
	});
};
