import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';

const QuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	size: z.coerce.number().int().min(1).max(100).default(20),
	search: z.string().optional()
});

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}
	if (locals.user.role !== 'ADMIN') {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'Only instance administrators can manage users'
		});
	}

	const parsed = QuerySchema.safeParse({
		page: url.searchParams.get('page') ?? undefined,
		size: url.searchParams.get('size') ?? undefined,
		search: url.searchParams.get('search') ?? undefined
	});
	if (!parsed.success) {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid query parameters' });
	}

	const { page, size, search } = parsed.data;
	const offset = (page - 1) * size;

	const { data: users, total } = await userRepository.findManyWithSearch({
		limit: size,
		offset,
		search,
		sort: { field: 'created_at', order: 'desc' }
	});

	// Batch-fetch profiles
	const userIds = users.map((u) => u.id);
	const profiles = await profileRepository.findByUserIds(userIds);
	const profileMap = new Map(profiles.map((p) => [p.user_id.toString(), p]));

	const data = users.map((u) => {
		const profile = profileMap.get(u.id.toString());
		return {
			id: u.id.toString(),
			username: u.username,
			did: u.did ?? null,
			role: u.role,
			created_at: u.created_at.toISOString(),
			display_name: profile?.display_name ?? u.username,
			avatar_url: profile?.avatar_url ?? null
		};
	});

	return json({
		status: 'success',
		data,
		pagination: { limit: size, offset, total, has_more: offset + size < total }
	});
};
