import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { isValidSyrDid } from '@syr-is/did';

export const GET: RequestHandler = async ({ params }) => {
	const raw = params.param;
	const key = decodeURIComponent(raw);

	const user = isValidSyrDid(key)
		? await userRepository.findByDid(key)
		: await userRepository.findByUsername(key);

	if (!user) {
		throw error(404, { code: 'NOT_FOUND', message: 'Profile not found' });
	}

	const profile = await profileRepository.findByUserId(user.id);
	if (!profile) {
		throw error(404, { code: 'NOT_FOUND', message: 'Profile not found' });
	}

	return json({
		status: 'success',
		data: {
			did: user.did ?? null,
			username: user.username,
			display_name: profile.display_name,
			bio: profile.bio,
			avatar_url: profile.avatar_url,
			banner_url: profile.banner_url,
			identity_host_url: profile.identity_host_url ?? null,
			content_signature: profile.content_signature,
			signed_payload_json: profile.signed_payload_json,
			signing_device_public_key: profile.signing_device_public_key
		}
	});
};
