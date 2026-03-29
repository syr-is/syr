import type { PageServerLoad } from './$types';
import { error, isHttpError } from '@sveltejs/kit';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { effectiveMaxPostPayloadBytes } from '$lib/client/content-limit-config';
import { isValidSyrDid } from '@syr-is/did';
import {
	getMergedDiscoveryBases,
	resolveProviderWithBases
} from '$lib/server/discovery-bases.server';
import { resolveRemoteEndpoints } from '$lib/server/resolve-remote-endpoints.server';

const REMOTE_FETCH_MS = 12_000;

export const load: PageServerLoad = async ({ params, url, locals }) => {
	let key: string;
	try {
		key = decodeURIComponent(params.param);
	} catch {
		throw error(400, 'Bad request');
	}

	// When ?provider= is present, always fetch from that provider (third-party instance)
	let explicitProvider: string | null = null;
	const rawProvider = url.searchParams.get('provider')?.trim().replace(/\/$/, '');
	if (rawProvider) {
		try {
			const u = new URL(rawProvider);
			if (u.protocol === 'http:' || u.protocol === 'https:') {
				explicitProvider = u.origin;
			}
		} catch {
			// invalid URL — ignore provider param
		}
	}

	if (!explicitProvider) {
		const user = isValidSyrDid(key)
			? await userRepository.findByDid(key)
			: await userRepository.findByUsername(key);

		if (user) {
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
					identity_host_url: profile.identity_host_url,
					content_signature: profile.content_signature,
					signed_payload_json: profile.signed_payload_json,
					signing_device_public_key: profile.signing_device_public_key
				},
				maxPostPayloadBytes: effectiveMaxPostPayloadBytes(undefined),
				profileSource: 'local' as const,
				resolvedProviderOrigin: null as string | null,
				remoteEndpoints: null as {
					posts: string;
					uploads: string;
					stories: string;
					web_profile: string | null;
				} | null
			};
		}
	}

	if (!isValidSyrDid(key)) {
		throw error(404, 'Not found');
	}

	let provider: string;
	if (explicitProvider) {
		provider = explicitProvider;
	} else {
		const bases = await getMergedDiscoveryBases({ userId: locals.user?.id });
		if (bases.length === 0) {
			throw error(404, 'Not found');
		}
		const resolved = await resolveProviderWithBases(key, bases, REMOTE_FETCH_MS);
		if (!resolved) {
			throw error(404, 'Not found');
		}
		provider = resolved;
	}

	const endpoints = await resolveRemoteEndpoints(key, provider, null, REMOTE_FETCH_MS);
	const profileUrl = endpoints.profile;
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), REMOTE_FETCH_MS);
	let body: { data?: Record<string, unknown> };
	try {
		const pres = await fetch(profileUrl, { signal: ctrl.signal });
		if (!pres.ok) {
			throw error(404, 'Not found');
		}
		body = (await pres.json()) as { data?: Record<string, unknown> };
	} catch (e) {
		if (isHttpError(e)) {
			throw e;
		}
		throw error(404, 'Not found');
	} finally {
		clearTimeout(timer);
	}

	const d = body.data;
	if (!d || typeof d !== 'object') {
		throw error(404, 'Not found');
	}
	if (typeof d.did === 'string' && d.did !== key) {
		throw error(404, 'Not found');
	}

	return {
		publicProfile: {
			did: key,
			username: typeof d.username === 'string' ? d.username : '—',
			display_name: typeof d.display_name === 'string' ? d.display_name : undefined,
			bio: typeof d.bio === 'string' ? d.bio : undefined,
			avatar_url: typeof d.avatar_url === 'string' ? d.avatar_url : undefined,
			banner_url: typeof d.banner_url === 'string' ? d.banner_url : undefined,
			identity_host_url: typeof d.identity_host_url === 'string' ? d.identity_host_url : null,
			content_signature: typeof d.content_signature === 'string' ? d.content_signature : undefined,
			signed_payload_json:
				typeof d.signed_payload_json === 'string' ? d.signed_payload_json : undefined,
			signing_device_public_key:
				typeof d.signing_device_public_key === 'string' ? d.signing_device_public_key : undefined
		},
		maxPostPayloadBytes: effectiveMaxPostPayloadBytes(undefined),
		profileSource: 'remote' as const,
		resolvedProviderOrigin: provider,
		remoteEndpoints: {
			posts: endpoints.posts,
			uploads: endpoints.uploads,
			stories: endpoints.stories,
			web_profile: endpoints.web_profile
		}
	};
};
