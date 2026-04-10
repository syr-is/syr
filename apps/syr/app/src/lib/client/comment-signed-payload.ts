import { signMutationPayload } from './signed-mutation';
import { canonicalize, initCryptoWasm } from '@syr-is/crypto';

export type CommentSignSnapshot = {
	content: string;
	post_did: string;
	post_id: string;
	ancestor_chain: string[];
	visibility: 'public' | 'unlisted' | 'private';
	status: 'draft' | 'completed';
};

export function buildCommentSignedPayloadV1(params: {
	did: string;
	commentLocalId: string;
	snapshot: CommentSignSnapshot;
	createdAtIso: string;
}): Record<string, unknown> {
	return {
		type: 'comment@v1',
		did: params.did,
		comment_id: params.commentLocalId,
		post_did: params.snapshot.post_did,
		post_id: params.snapshot.post_id,
		ancestor_chain: params.snapshot.ancestor_chain,
		content: params.snapshot.content,
		visibility: params.snapshot.visibility,
		status: params.snapshot.status,
		created_at: params.createdAtIso
	};
}

/**
 * Sign a comment with a root key seed.
 * Returns the three fields to PATCH onto the comment record.
 */
export async function signCommentWithRootKey(params: {
	did: string;
	commentLocalId: string;
	snapshot: CommentSignSnapshot;
	createdAtIso: string;
	rootSeed32: Uint8Array;
	identityPublicKeyMultibase: string;
}): Promise<{
	content_signature: string;
	signed_payload_json: string;
	signing_device_public_key: string;
}> {
	await initCryptoWasm();

	const payload = buildCommentSignedPayloadV1({
		did: params.did,
		commentLocalId: params.commentLocalId,
		snapshot: params.snapshot,
		createdAtIso: params.createdAtIso
	});

	const signature = await signMutationPayload(payload, params.rootSeed32);
	const payloadJson = canonicalize(payload);

	return {
		content_signature: signature,
		signed_payload_json: payloadJson,
		signing_device_public_key: params.identityPublicKeyMultibase
	};
}
