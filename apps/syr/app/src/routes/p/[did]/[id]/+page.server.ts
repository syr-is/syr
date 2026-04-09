import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isValidSyrDid } from '@syr-is/did';
import { postController } from '$lib/controllers/post.controller';
import { resolveMediaUrlMetadata } from '$lib/utils/post-media.server';
import { extractDid, extractLocalId, stringToRecordId } from '@syr-is/types';
import { followRepository } from '$lib/repositories/follow.repository';
import { userRepository } from '$lib/repositories/user.repository';

/**
 * Public read-only post page (no login). Linked from /u/… profiles.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	let did: string;
	let localId: string;
	try {
		did = decodeURIComponent(params.did);
		localId = decodeURIComponent(params.id);
	} catch {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid encoding' });
	}

	if (!isValidSyrDid(did)) {
		throw error(400, { code: 'BAD_REQUEST', message: 'Invalid DID' });
	}

	const post = await postController.getPublicPost(did, localId);
	if (!post) {
		throw error(404, { code: 'NOT_FOUND', message: 'Post not found' });
	}

	const serializedPost = {
		...post,
		id: post.id.toString(),
		did: extractDid(post.id),
		local_id: extractLocalId(post.id),
		author_id: post.author_id.toString(),
		created_at: post.created_at.toISOString(),
		updated_at: post.updated_at.toISOString()
	};

	const { mimeTypes: mediaUrlMimeTypes, filenames: mediaUrlFilenames } =
		post.type === 'media' && post.media_urls?.length
			? await resolveMediaUrlMetadata(post.media_urls)
			: { mimeTypes: {}, filenames: {} };

	// Load user context for comments/reactions if logged in
	let currentUserDid: string | null = null;
	let followedDids: Array<{ did: string; providerUrl: string }> = [];
	if (locals.user) {
		try {
			const user = await userRepository.findById(locals.user.id);
			currentUserDid = user?.did ?? null;
			const uid = user?.id ?? stringToRecordId.decode(locals.user.id);
			const follows = await followRepository.findByFollower(uid);
			followedDids = follows
				.filter((f) => f.followed_provider_url)
				.map((f) => ({
					did: f.followed_did,
					providerUrl: f.followed_provider_url!
				}));
		} catch {
			/* non-critical */
		}
	}

	return {
		post: serializedPost,
		mediaUrlMimeTypes,
		mediaUrlFilenames,
		currentUserDid,
		followedDids
	};
};
