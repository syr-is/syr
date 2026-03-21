import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { isValidSyrDid } from '@syr-is/did';

export const load: PageServerLoad = async ({ params }) => {
	let key: string;
	try {
		key = decodeURIComponent(params.param);
	} catch {
		throw error(400, 'Bad request');
	}
	const user = isValidSyrDid(key)
		? await userRepository.findByDid(key)
		: await userRepository.findByUsername(key);

	if (!user) {
		throw error(404, 'Not found');
	}

	const profile = await profileRepository.findByUserId(user.id);
	if (!profile) {
		throw error(404, 'Not found');
	}

	return {
		publicProfile: {
			did: user.did ?? null,
			username: user.username,
			display_name: profile.display_name,
			bio: profile.bio,
			avatar_url: profile.avatar_url,
			banner_url: profile.banner_url,
			content_signature: profile.content_signature,
			signed_payload_json: profile.signed_payload_json,
			signing_device_public_key: profile.signing_device_public_key
		}
	};
};
