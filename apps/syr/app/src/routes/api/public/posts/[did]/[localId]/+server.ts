import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isValidSyrDid } from '@syr-is/did';
import { postController } from '$lib/controllers/post.controller';
import { extractDid, extractLocalId } from '@syr-is/types';

export const GET: RequestHandler = async ({ params }) => {
	let did: string;
	let localId: string;
	try {
		did = decodeURIComponent(params.did);
		localId = decodeURIComponent(params.localId);
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

	return json({
		status: 'success',
		data: {
			...post,
			id: post.id.toString(),
			did: extractDid(post.id),
			local_id: extractLocalId(post.id),
			author_id: post.author_id.toString()
		}
	});
};
