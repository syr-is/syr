import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { followRepository } from '$lib/repositories/follow.repository';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/login');
	}

	const rows = await followRepository.findByFollower(locals.user.id);
	return {
		follows: rows.map((r) => ({
			followed_did: r.followed_did,
			source_registry: r.source_registry ?? null,
			created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
		}))
	};
};
