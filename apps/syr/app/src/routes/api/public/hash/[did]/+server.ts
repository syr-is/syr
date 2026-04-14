import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isValidSyrDid } from '@syr-is/did';
import { createHash } from 'node:crypto';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { uploadRepository } from '$lib/repositories/upload.repository';
import { emojiRepository } from '$lib/repositories/emoji.repository';
import { gifRepository } from '$lib/repositories/gif.repository';

const STORY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/public/hash/[did]
 *
 * Lightweight digest that changes whenever the user's profile or their
 * active (24h) stories change. Federated clients poll this cheaply to
 * decide whether to refetch the full profile / stories payload.
 *
 * Intentionally no DB joins or full-row fetches — we only read the
 * `updated_at` / `published_at` timestamps needed to build the digest.
 */
export const GET: RequestHandler = async ({ params }) => {
	let did: string;
	try {
		did = decodeURIComponent(params.did);
	} catch {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid DID' });
	}
	if (!isValidSyrDid(did)) {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid DID' });
	}

	const user = await userRepository.findByDid(did);
	if (!user) throw error(404, { code: 'NOT_FOUND', message: 'Profile not found' });

	const profile = await profileRepository.findByUserId(user.id);

	const since = new Date(Date.now() - STORY_WINDOW_MS);
	const activeStories = await uploadRepository.findActiveStoriesByDid(did, since);
	const latestStoryTs = activeStories.reduce((max, u) => {
		const t = (u.published_at ?? u.updated_at).getTime();
		return t > max ? t : max;
	}, 0);

	// Include sorted per-story identifiers so changes to the set change the hash
	const storyIds = activeStories
		.map((u) => u.id.toString())
		.sort()
		.join(',');

	// Lightweight emoji/GIF digest: count + latest updated_at per table
	const [emojiDigestData, gifDigestData] = await Promise.all([
		emojiRepository.digestByDid(did),
		gifRepository.digestByDid(did)
	]);
	const emojiDigest = `e:${emojiDigestData.count}:${emojiDigestData.latestUpdatedAt ?? ''}`;
	const gifDigest = `g:${gifDigestData.count}:${gifDigestData.latestUpdatedAt ?? ''}`;

	const parts = [
		profile?.updated_at?.toISOString() ?? '',
		profile?.content_signature ?? '',
		String(activeStories.length),
		latestStoryTs ? new Date(latestStoryTs).toISOString() : '',
		storyIds,
		emojiDigest,
		gifDigest
	];

	const hash = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);

	return json(
		{
			status: 'success',
			data: {
				did,
				hash,
				profile_updated_at: profile?.updated_at?.toISOString() ?? null,
				story_count: activeStories.length,
				latest_story_at: latestStoryTs ? new Date(latestStoryTs).toISOString() : null
			}
		},
		{
			headers: {
				// Tight cache — this endpoint is meant to be polled
				'Cache-Control': 'public, max-age=5'
			}
		}
	);
};
