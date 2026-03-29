import type { PageServerLoad } from './$types';
import { isValidSyrDid } from '@syr-is/did';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { resolveRemoteEndpoints } from '$lib/server/resolve-remote-endpoints.server';

export const load: PageServerLoad = async ({ url, locals }) => {
	const targetDid = url.searchParams.get('target_did')?.trim() ?? '';
	const providerParam = url.searchParams.get('provider')?.trim().replace(/\/$/, '') || null;

	if (!targetDid || !isValidSyrDid(targetDid)) {
		return { error: 'invalid_did' as const, targetDid: targetDid || null, provider: null };
	}

	const viewerDid = locals.user?.did;
	if (viewerDid && viewerDid === targetDid) {
		return { error: 'self_follow' as const, targetDid, provider: null };
	}

	// When provider param is given, fetch profile from that remote provider
	if (providerParam) {
		try {
			const endpoints = await resolveRemoteEndpoints(targetDid, providerParam, null, 12_000);
			const res = await fetch(endpoints.profile, { signal: AbortSignal.timeout(12_000) });
			if (res.ok) {
				const body = (await res.json()) as { data?: Record<string, unknown> };
				const d = body.data;
				if (d && typeof d === 'object') {
					return {
						error: null,
						targetDid,
						provider: providerParam,
						targetProfile: {
							username: typeof d.username === 'string' ? d.username : '—',
							display_name: typeof d.display_name === 'string' ? d.display_name : null,
							avatar_url: typeof d.avatar_url === 'string' ? d.avatar_url : null,
							bio: typeof d.bio === 'string' ? d.bio : null,
							identity_host_url:
								typeof d.identity_host_url === 'string' ? d.identity_host_url : null
						}
					};
				}
			}
		} catch {
			// Fall through to show "no profile found" with follow button
		}
		return { error: null, targetDid, provider: providerParam, targetProfile: null };
	}

	const user = await userRepository.findByDid(targetDid);
	const profile = user ? await profileRepository.findByUserId(user.id) : null;

	return {
		error: null,
		targetDid,
		provider: null,
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
