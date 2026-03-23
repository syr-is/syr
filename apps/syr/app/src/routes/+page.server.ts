import type { PageServerLoad } from './$types';
import { userRepository } from '$lib/repositories/user.repository';
import { followRepository } from '$lib/repositories/follow.repository';
import { effectiveMaxPostPayloadBytes } from '$lib/client/content-limit-config';

export const load: PageServerLoad = async ({ locals }) => {
	let maxPostPayloadBytes = effectiveMaxPostPayloadBytes(undefined);
	let followerCount = 0;
	let followingCount = 0;
	if (locals.user) {
		try {
			const user = await userRepository.findById(locals.user.id);
			if (user) {
				maxPostPayloadBytes = effectiveMaxPostPayloadBytes(
					user.content_max_post_bytes ?? undefined
				);
				const [following, followers] = await Promise.all([
					followRepository.countByFollower(locals.user.id),
					user.did ? followRepository.countFollowersOfDid(user.did) : Promise.resolve(0)
				]);
				followingCount = following;
				followerCount = followers;
			}
		} catch (e) {
			console.error('[+page.server] load user/follow counts:', e);
		}
	}
	return {
		user: locals.user,
		maxPostPayloadBytes,
		followerCount,
		followingCount
	};
};
