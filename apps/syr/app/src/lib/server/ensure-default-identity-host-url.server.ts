import { profileRepository } from '$lib/repositories/profile.repository';
import { defaultIdentityHostUrl } from '$lib/identity-host-default';
import { config } from '$lib/config';
import type { RecordId } from 'surrealdb';

/**
 * Sets `identity_host_url` to this instance’s `/u/<did>` when the profile has none yet.
 */
export async function ensureDefaultIdentityHostUrl(
	userId: RecordId | string,
	did: string
): Promise<void> {
	const profile = await profileRepository.findByUserId(userId);
	if (profile?.identity_host_url) return;
	await profileRepository.mergeByUserId(userId, {
		identity_host_url: defaultIdentityHostUrl(config.PUBLIC_URL, did)
	});
}
