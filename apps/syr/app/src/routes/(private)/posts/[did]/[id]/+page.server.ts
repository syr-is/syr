import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { postController } from '$lib/controllers/post.controller';
import { userRepository } from '$lib/repositories/user.repository';
import { contentTrustRuleRepository } from '$lib/repositories/content-trust-rule.repository';
import { registryRepository } from '$lib/repositories/registry.repository';
import { resolveMediaUrlMetadata } from '$lib/utils/post-media.server';
import {
	recordIdFromDidAndLocal,
	extractDid,
	extractLocalId,
	stringToRecordId
} from '@syr-is/types';
import { followRepository } from '$lib/repositories/follow.repository';

export const load: PageServerLoad = async ({ params, locals }) => {
	// Get post by ID
	const postId = recordIdFromDidAndLocal('post', params.did, params.id);
	const post = await postController.getPost(postId);

	if (!post) {
		throw error(404, {
			code: 'NOT_FOUND',
			message: 'Post not found'
		});
	}

	// Check visibility
	// Public posts are viewable by anyone
	// Unlisted posts are viewable by anyone (but not listed in feeds)
	// Private posts are only viewable by the author
	let user = null;
	if (post.visibility === 'private') {
		if (!locals.user) {
			throw error(401, {
				code: 'AUTHENTICATION_ERROR',
				message: 'Unauthorized'
			});
		}

		user = await userRepository.findById(locals.user.id);
		if (!user) {
			throw error(400, {
				code: 'BAD_REQUEST',
				message: 'Invalid User'
			});
		}

		// Verify user owns the post
		if (post.author_id.toString() !== user.id.toString()) {
			throw error(403, {
				code: 'FORBIDDEN',
				message: 'You do not have permission to view this post'
			});
		}
	} else if (locals.user) {
		// Load user if logged in (for edit button check)
		user = await userRepository.findById(locals.user.id);
	}

	// Serialize post for client (convert RecordId to string, Date to ISO string)
	const serializedPost = {
		...post,
		id: post.id.toString(),
		did: extractDid(post.id),
		local_id: extractLocalId(post.id),
		author_id: post.author_id.toString(),
		created_at: post.created_at.toISOString(),
		updated_at: post.updated_at.toISOString()
	};

	// Serialize user if present
	const serializedUser = user
		? {
				...user,
				id: user.id.toString(),
				created_at: user.created_at.toISOString(),
				updated_at: user.updated_at.toISOString()
			}
		: null;

	// Resolve mime types and filenames for media post URLs from the upload DB records
	const { mimeTypes: mediaUrlMimeTypes, filenames: mediaUrlFilenames } =
		post.type === 'media' && post.media_urls?.length
			? await resolveMediaUrlMetadata(post.media_urls)
			: { mimeTypes: {}, filenames: {} };

	let contentTrust: {
		rules: Array<{ pattern: string; kind: 'allow' | 'deny'; sort_order: number }>;
		allowDataUrls: boolean;
		autoAuthorProvider: boolean;
		implicitAllowPrefixes: string[];
	};

	if (locals.user) {
		const uid = stringToRecordId.decode(locals.user.id);
		const rules = await contentTrustRuleRepository.findByUserId(uid);
		const implicitAllowPrefixes: string[] = [];
		const authorDid = extractDid(post.id);
		if (user?.content_trust_auto_author_provider && authorDid) {
			const regs = await registryRepository.findByDid(authorDid);
			for (const r of regs) {
				try {
					const u = new URL(r.registry_url);
					implicitAllowPrefixes.push(`${u.origin}/`);
				} catch {
					// skip invalid registry URL
				}
			}
		}
		contentTrust = {
			rules: rules.map((r) => ({
				pattern: r.pattern,
				kind: r.kind,
				sort_order: r.sort_order
			})),
			allowDataUrls: user?.content_trust_allow_data_urls ?? false,
			autoAuthorProvider: user?.content_trust_auto_author_provider ?? false,
			implicitAllowPrefixes
		};
	} else {
		contentTrust = {
			rules: [],
			allowDataUrls: false,
			autoAuthorProvider: false,
			implicitAllowPrefixes: []
		};
	}

	// Load followed DIDs with provider URLs for cross-instance comment fetching
	let followedDids: Array<{ did: string; providerUrl: string }> = [];
	if (locals.user) {
		try {
			const uid = user?.id ?? stringToRecordId.decode(locals.user.id);
			const follows = await followRepository.findByFollower(uid);
			followedDids = follows
				.filter((f) => f.followed_provider_url)
				.map((f) => ({
					did: f.followed_did,
					providerUrl: f.followed_provider_url!
				}));
		} catch {
			// Non-critical — comments will just not load from remote instances
		}
	}

	return {
		post: serializedPost,
		user: serializedUser,
		mediaUrlMimeTypes,
		mediaUrlFilenames,
		contentTrust,
		followedDids
	};
};
