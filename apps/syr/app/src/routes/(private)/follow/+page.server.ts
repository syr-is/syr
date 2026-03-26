import type { PageServerLoad } from './$types';
import { isValidSyrDid } from '@syr-is/did';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';

export const load: PageServerLoad = async ({ url, locals }) => {
	const targetDid = url.searchParams.get('target_did')?.trim() ?? '';
	if (!targetDid || !isValidSyrDid(targetDid)) {
		return { error: 'invalid_did' as const, targetDid: targetDid || null };
	}

	const viewerDid = locals.user?.did;
	if (viewerDid && viewerDid === targetDid) {
		return { error: 'self_follow' as const, targetDid };
	}

	const user = await userRepository.findByDid(targetDid);
	const profile = user ? await profileRepository.findByUserId(user.id) : null;

	return {
		error: null,
		targetDid,
		targetProfile:
			user && profile
				? {
						username: user.username,
						display_name: profile.display_name,
						avatar_url: profile.avatar_url ?? null,
						bio: profile.bio ?? null,
						identity_host_url: profile.identity_host_url ?? null
					}
				: null
	};
};
