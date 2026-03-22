import type { PageServerLoad } from './$types';
import { userRepository } from '$lib/repositories/user.repository';
import { effectiveMaxPostPayloadBytes } from '$lib/client/content-limit-config';

export const load: PageServerLoad = async ({ locals }) => {
	let maxPostPayloadBytes = effectiveMaxPostPayloadBytes(undefined);
	let feedHideUnsignedPosts = false;
	if (locals.user) {
		const user = await userRepository.findById(locals.user.id);
		if (user) {
			maxPostPayloadBytes = effectiveMaxPostPayloadBytes(user.content_max_post_bytes ?? undefined);
			feedHideUnsignedPosts = user.feed_hide_unsigned_posts === true;
		}
	}

	return {
		user: locals.user,
		maxPostPayloadBytes,
		feedHideUnsignedPosts
	};
};
