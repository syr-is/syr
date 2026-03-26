import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { effectiveMaxPostPayloadBytes } from '$lib/client/content-limit-config';
import { isValidSyrDid } from '@syr-is/did';
import {
	getMergedDiscoveryBases,
	resolveProviderWithBases
} from '$lib/server/discovery-bases.server';

const REMOTE_FETCH_MS = 12_000;

export const load: PageServerLoad = async ({ params, locals }) => {
	let key: string;
	try {
		key = decodeURIComponent(params.param);
	} catch {
		throw error(400, 'Bad request');
	}

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
			resolvedProviderOrigin: null as string | null
		};
	}

	if (!isValidSyrDid(key)) {
		throw error(404, 'Not found');
	}

	const bases = await getMergedDiscoveryBases({ userId: locals.user?.id });
	if (bases.length === 0) {
		throw error(404, 'Not found');
	}

	const provider = await resolveProviderWithBases(key, bases, REMOTE_FETCH_MS);
	if (!provider) {
		throw error(404, 'Not found');
	}

	const profileUrl = `${provider}/api/public/profile/${encodeURIComponent(key)}`;
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), REMOTE_FETCH_MS);
	let pres: Response;
	try {
		pres = await fetch(profileUrl, { signal: ctrl.signal });
	} finally {
		clearTimeout(timer);
	}
	if (!pres.ok) {
		throw error(404, 'Not found');
	}

	const body = (await pres.json()) as { data?: Record<string, unknown> };
	const d = body.data;
	if (!d || typeof d !== 'object') {
		throw error(404, 'Not found');
	}

	return {
		publicProfile: {
			did: (typeof d.did === 'string' ? d.did : key) || key,
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
		resolvedProviderOrigin: provider
	};
};
