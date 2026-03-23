/**
 * Build `post@v1` signed payloads and envelopes for post create/update.
 * Must stay aligned with `assertPostCreateSignedMutation` / `assertPostUpdateSignedMutation`.
 */

import {
	PostSignedPayloadV1Schema,
	PostDeleteSignedPayloadV1Schema,
	ProfileSignedPayloadV1Schema,
	type PostSignedPayloadV1,
	type SignedMutationEnvelope
} from '@syr-is/types';
import {
	initCryptoWasm,
	canonicalize,
	verify,
	decodeMultibase,
	decodePublicKey
} from '@syr-is/crypto';
import { signMutationPayload } from './signed-mutation';

export type PostSignSnapshot = {
	type: 'blog' | 'media';
	title?: string;
	description?: string;
	content?: string;
	content_type?: 'markdown' | 'html';
	media_urls?: string[];
	display_mode?: 'carousel' | 'masonry' | 'gallery' | 'cards';
	visibility: 'public' | 'unlisted' | 'private';
};

function trimOpt(s: string | undefined): string | undefined {
	if (s === undefined) return undefined;
	const t = s.trim();
	return t === '' ? undefined : t;
}

/**
 * Build the exact `post@v1` object to sign and embed in `signed_mutation.payload`.
 */
export function buildPostSignedPayloadV1(params: {
	did: string;
	postLocalId: string;
	status: 'draft' | 'completed';
	snapshot: PostSignSnapshot;
	mode: 'create' | 'update';
	/** Required for `update`: ISO string matching stored `post.created_at` */
	existingCreatedAtIso?: string;
}): PostSignedPayloadV1 {
	const { did, postLocalId, status, snapshot, mode, existingCreatedAtIso } = params;

	let created_at: string;
	if (mode === 'create') {
		created_at = new Date().toISOString();
	} else {
		const t = existingCreatedAtIso?.trim();
		if (!t) {
			throw new Error('existingCreatedAtIso is required and non-empty when mode is "update"');
		}
		created_at = t;
	}

	const base: Record<string, unknown> = {
		type: 'post@v1',
		did,
		post_id: postLocalId,
		post_type: snapshot.type,
		visibility: snapshot.visibility,
		status,
		created_at
	};

	if (snapshot.type === 'blog') {
		const title = trimOpt(snapshot.title);
		const description = trimOpt(snapshot.description);
		const content = trimOpt(snapshot.content);
		if (title !== undefined) base.title = title;
		if (description !== undefined) base.description = description;
		if (content !== undefined) base.content = content;
		if (snapshot.content_type != null) base.content_type = snapshot.content_type;
	} else {
		const title = trimOpt(snapshot.title);
		const description = trimOpt(snapshot.description);
		if (title !== undefined) base.title = title;
		if (description !== undefined) base.description = description;
		const raw = snapshot.media_urls;
		const urls =
			Array.isArray(raw) && raw.every((u) => typeof u === 'string')
				? raw.map((u) => u.trim()).filter(Boolean)
				: [];
		base.media_urls = urls;
		const dm = snapshot.display_mode;
		if (dm != null) base.display_mode = dm;
	}

	return PostSignedPayloadV1Schema.parse(base);
}

/** Sign payload with root seed; `device_public_key` must be the account root multibase public key. */
export async function signPostMutationWithRootKey(
	payload: PostSignedPayloadV1,
	rootSeed32: Uint8Array,
	identityPublicKeyMultibase: string
): Promise<SignedMutationEnvelope> {
	const p = PostSignedPayloadV1Schema.parse(payload);
	const record = { ...p } as unknown as Record<string, unknown>;
	const signature = await signMutationPayload(record, rootSeed32);
	return {
		payload: record,
		signature,
		device_public_key: identityPublicKeyMultibase
	};
}

function mutationPayloadShapeValid(payload: Record<string, unknown>): boolean {
	const t = payload.type;
	if (t === 'post@v1') return PostSignedPayloadV1Schema.safeParse(payload).success;
	if (t === 'profile@v1') return ProfileSignedPayloadV1Schema.safeParse(payload).success;
	if (t === 'post-delete@v1') return PostDeleteSignedPayloadV1Schema.safeParse(payload).success;
	return false;
}

/** Local Ed25519 verify over JCS — same idea as `signature-verification.svelte`. */
export async function verifySignedMutationEnvelopeLocally(
	envelope: SignedMutationEnvelope
): Promise<boolean> {
	const payload = envelope.payload as Record<string, unknown>;
	if (!mutationPayloadShapeValid(payload)) {
		return false;
	}
	await initCryptoWasm();
	try {
		const msg = canonicalize(envelope.payload);
		const sig = decodeMultibase(envelope.signature);
		const pk = decodePublicKey(envelope.device_public_key);
		return await verify(msg, sig, pk);
	} catch {
		return false;
	}
}
