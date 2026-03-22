import type { PageServerLoad } from './$types';
import { userRepository } from '$lib/repositories/user.repository';
import { followRepository } from '$lib/repositories/follow.repository';
import { effectiveMaxPostPayloadBytes } from '$lib/client/content-limit-config';

export const load: PageServerLoad = async ({ locals }) => {
	let maxPostPayloadBytes = effectiveMaxPostPayloadBytes(undefined);
	let followerCount = 0;
	let followingCount = 0;
	if (locals.user) {
		const user = await userRepository.findById(locals.user.id);
		if (user) {
			maxPostPayloadBytes = effectiveMaxPostPayloadBytes(user.content_max_post_bytes ?? undefined);
			followingCount = await followRepository.countByFollower(locals.user.id);
			if (user.did) {
				followerCount = await followRepository.countFollowersOfDid(user.did);
			}
		}
	}
	return {
		user: locals.user,
		maxPostPayloadBytes,
		followerCount,
		followingCount
	};
};
