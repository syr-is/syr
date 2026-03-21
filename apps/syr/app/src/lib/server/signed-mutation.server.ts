import { error } from '@sveltejs/kit';
import { identityController } from '$lib/controllers/identity.controller';
import { identityRepository } from '$lib/repositories/identity.repository';
import { userRepository } from '$lib/repositories/user.repository';
import { signedMutations } from '$lib/config';
import {
	ProfileSignedPayloadV1Schema,
	PostSignedPayloadV1Schema,
	PostDeleteSignedPayloadV1Schema,
	stringToRecordId,
	type Post,
	type PostCreate,
	type SignedMutationEnvelope,
	type Identity
} from '@syr-is/types';
import { extractLocalId } from '@syr-is/types';
import type { RecordId } from 'surrealdb';

export type StoredSignatureFields = {
	content_signature: string;
	signed_payload_json: string;
	signing_device_public_key: string;
};

export type PostCreateSignatureResult = {
	signature?: StoredSignatureFields;
	/** When signing, row timestamps use the client-signed ISO time */
	postCreatedAt?: Date;
};

function normalizeOptStr(v: unknown): string | undefined {
	if (v === undefined || v === null) return undefined;
	const s = String(v).trim();
	return s === '' ? undefined : s;
}

function stableMetadataJson(meta: unknown): string {
	if (meta === undefined || meta === null) return 'null';
	if (typeof meta !== 'object') return JSON.stringify(meta);
	return JSON.stringify(meta, Object.keys(meta as object).sort());
}

async function loadIdentityForUser(userRecordId: string): Promise<{
	user: NonNullable<Awaited<ReturnType<typeof userRepository.findById>>>;
	identity: Identity;
} | null> {
	const uid = stringToRecordId.decode(userRecordId);
	const user = await userRepository.findById(uid);
	if (!user?.did) return null;
	const identity = await identityRepository.findByUserId(uid);
	if (!identity) return null;
	return { user, identity };
}

export async function assertProfileSignedMutation(
	userRecordId: string,
	envelope: SignedMutationEnvelope | undefined,
	profileFields: {
		display_name?: string;
		bio?: string;
		avatar_url?: string;
		banner_url?: string;
		metadata?: Record<string, unknown>;
	}
): Promise<{ signature?: StoredSignatureFields }> {
	const ctx = await loadIdentityForUser(userRecordId);
	if (!ctx) {
		return {};
	}

	const { user, identity } = ctx;
	const must = signedMutations.requireSigned;

	if (!envelope) {
		if (must) {
			throw error(400, {
				code: 'SIGNED_MUTATION_REQUIRED',
				message:
					'A signed profile update is required for accounts with an identity on this instance.'
			});
		}
		return {};
	}

	try {
		await identityController.verifyClientSignedContent(
			identity,
			envelope.payload,
			envelope.signature,
			envelope.device_public_key
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Invalid signature';
		throw error(400, { code: 'INVALID_SIGNATURE', message: msg });
	}

	const parsed = ProfileSignedPayloadV1Schema.safeParse(envelope.payload);
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Signed profile payload has invalid shape'
		});
	}

	const p = parsed.data;
	if (p.did !== user.did) {
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'Profile signature DID does not match your account.'
		});
	}

	if (p.display_name !== profileFields.display_name) {
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'Signed profile payload does not match submitted fields (display_name).'
		});
	}
	if (normalizeOptStr(p.bio) !== normalizeOptStr(profileFields.bio)) {
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'Signed profile payload does not match submitted fields (bio).'
		});
	}
	if (normalizeOptStr(p.avatar_url) !== normalizeOptStr(profileFields.avatar_url)) {
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'Signed profile payload does not match submitted fields (avatar_url).'
		});
	}
	if (normalizeOptStr(p.banner_url) !== normalizeOptStr(profileFields.banner_url)) {
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'Signed profile payload does not match submitted fields (banner_url).'
		});
	}
	if (stableMetadataJson(p.metadata) !== stableMetadataJson(profileFields.metadata)) {
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'Signed profile payload does not match submitted fields (metadata).'
		});
	}

	return {
		signature: {
			content_signature: envelope.signature,
			signed_payload_json: JSON.stringify(envelope.payload),
			signing_device_public_key: envelope.device_public_key
		}
	};
}

const CREATED_AT_SKEW_MS = 5 * 60 * 1000;

function assertCreatedAtRecent(iso: string): void {
	const t = Date.parse(iso);
	if (Number.isNaN(t)) {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid created_at in signed payload' });
	}
	if (Math.abs(Date.now() - t) > CREATED_AT_SKEW_MS) {
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'Signed post payload created_at is outside the allowed time window.'
		});
	}
}

export async function assertPostCreateSignedMutation(
	userRecordId: string,
	envelope: SignedMutationEnvelope | undefined,
	postLocalId: string | undefined,
	post: PostCreate
): Promise<PostCreateSignatureResult> {
	const ctx = await loadIdentityForUser(userRecordId);
	if (!ctx) {
		throw error(400, {
			code: 'IDENTITY_REQUIRED',
			message: 'You need an identity to create posts.'
		});
	}

	const { user, identity } = ctx;
	const must = signedMutations.requireSigned;

	if (!envelope || !postLocalId) {
		if (must) {
			throw error(400, {
				code: 'SIGNED_MUTATION_REQUIRED',
				message: 'Signed post creation requires post_local_id and signed_mutation.'
			});
		}
		if (envelope || postLocalId) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message:
					'Provide both post_local_id and signed_mutation, or omit both when signing is not required.'
			});
		}
		return { signature: undefined, postCreatedAt: undefined };
	}

	try {
		await identityController.verifyClientSignedContent(
			identity,
			envelope.payload,
			envelope.signature,
			envelope.device_public_key
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Invalid signature';
		throw error(400, { code: 'INVALID_SIGNATURE', message: msg });
	}

	const parsed = PostSignedPayloadV1Schema.safeParse(envelope.payload);
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Signed post payload has invalid shape'
		});
	}

	const p = parsed.data;
	if (p.did !== user.did || p.post_id !== postLocalId) {
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'Signed post payload does not match DID or post_local_id.'
		});
	}

	assertCreatedAtRecent(p.created_at);

	if (
		p.post_type !== post.type ||
		normalizeOptStr(p.title) !== normalizeOptStr(post.title) ||
		normalizeOptStr(p.description) !== normalizeOptStr(post.description) ||
		normalizeOptStr(p.content) !== normalizeOptStr(post.content) ||
		normalizeOptStr(p.content_type) !== normalizeOptStr(post.content_type) ||
		JSON.stringify(p.media_urls ?? null) !== JSON.stringify(post.media_urls ?? null) ||
		normalizeOptStr(p.display_mode) !== normalizeOptStr(post.display_mode) ||
		p.visibility !== post.visibility ||
		p.status !== post.status
	) {
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'Signed post payload does not match submitted post fields.'
		});
	}

	return {
		signature: {
			content_signature: envelope.signature,
			signed_payload_json: JSON.stringify(envelope.payload),
			signing_device_public_key: envelope.device_public_key
		},
		postCreatedAt: new Date(p.created_at)
	};
}

function postCreatedAtIso(post: Post): string {
	const d = post.created_at;
	return d instanceof Date ? d.toISOString() : new Date(d as unknown as string).toISOString();
}

export async function assertPostUpdateSignedMutation(
	userRecordId: string,
	envelope: SignedMutationEnvelope | undefined,
	existingPost: Post,
	resolved: {
		type: Post['type'];
		title?: string;
		description?: string;
		content?: string;
		content_type?: Post['content_type'];
		media_urls?: string[];
		display_mode?: Post['display_mode'];
		visibility: Post['visibility'];
		status: Post['status'];
	},
	postId: RecordId
): Promise<{ signature?: StoredSignatureFields }> {
	const ctx = await loadIdentityForUser(userRecordId);
	if (!ctx) {
		throw error(400, {
			code: 'IDENTITY_REQUIRED',
			message: 'Identity required for this post operation.'
		});
	}

	const { user, identity } = ctx;
	const must = signedMutations.requireSigned;
	const localId = extractLocalId(postId);

	if (!envelope) {
		if (must) {
			throw error(400, {
				code: 'SIGNED_MUTATION_REQUIRED',
				message: 'A signed mutation is required for post changes on this instance.'
			});
		}
		return {};
	}

	try {
		await identityController.verifyClientSignedContent(
			identity,
			envelope.payload,
			envelope.signature,
			envelope.device_public_key
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Invalid signature';
		throw error(400, { code: 'INVALID_SIGNATURE', message: msg });
	}

	const parsed = PostSignedPayloadV1Schema.safeParse(envelope.payload);
	if (!parsed.success) {
		throw error(400, {
			code: 'VALIDATION_ERROR',
			message: 'Signed post payload has invalid shape'
		});
	}

	const p = parsed.data;
	if (p.did !== user.did || p.post_id !== localId) {
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'Signed post payload does not match this post.'
		});
	}

	assertCreatedAtRecent(p.created_at);

	const createdIso = postCreatedAtIso(existingPost);
	if (p.created_at !== createdIso) {
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'Signed post payload created_at must match the post creation time.'
		});
	}

	if (
		p.post_type !== resolved.type ||
		normalizeOptStr(p.title) !== normalizeOptStr(resolved.title) ||
		normalizeOptStr(p.description) !== normalizeOptStr(resolved.description) ||
		normalizeOptStr(p.content) !== normalizeOptStr(resolved.content) ||
		normalizeOptStr(p.content_type) !== normalizeOptStr(resolved.content_type) ||
		JSON.stringify(p.media_urls ?? null) !== JSON.stringify(resolved.media_urls ?? null) ||
		normalizeOptStr(p.display_mode) !== normalizeOptStr(resolved.display_mode) ||
		p.visibility !== resolved.visibility ||
		p.status !== resolved.status
	) {
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'Signed post payload does not match the update being applied.'
		});
	}

	return {
		signature: {
			content_signature: envelope.signature,
			signed_payload_json: JSON.stringify(envelope.payload),
			signing_device_public_key: envelope.device_public_key
		}
	};
}

export async function assertPostDeleteSigned(
	userRecordId: string,
	envelope: SignedMutationEnvelope | undefined,
	postId: RecordId
): Promise<void> {
	const ctx = await loadIdentityForUser(userRecordId);
	if (!ctx) {
		throw error(400, { code: 'IDENTITY_REQUIRED', message: 'Identity required to delete posts.' });
	}

	const { user, identity } = ctx;
	const must = signedMutations.requireSigned;
	const localId = extractLocalId(postId);

	if (!envelope) {
		if (must) {
			throw error(400, {
				code: 'SIGNED_MUTATION_REQUIRED',
				message: 'A signed delete payload is required on this instance.'
			});
		}
		return;
	}

	try {
		await identityController.verifyClientSignedContent(
			identity,
			envelope.payload,
			envelope.signature,
			envelope.device_public_key
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Invalid signature';
		throw error(400, { code: 'INVALID_SIGNATURE', message: msg });
	}

	const parsed = PostDeleteSignedPayloadV1Schema.safeParse(envelope.payload);
	if (!parsed.success || parsed.data.did !== user.did || parsed.data.post_id !== localId) {
		throw error(400, {
			code: 'INVALID_SIGNATURE',
			message: 'Signed delete payload does not match this post.'
		});
	}
}
