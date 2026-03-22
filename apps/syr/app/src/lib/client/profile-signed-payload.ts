/**
 * Build `profile@v1` signed payloads for PATCH /api/user/profile.
 * Must stay aligned with `assertProfileSignedMutation`.
 */

import {
	ProfileSignedPayloadV1Schema,
	type ProfileSignedPayloadV1,
	type SignedMutationEnvelope
} from '@syr-is/types';
import { signMutationPayload } from './signed-mutation';
import { verifySignedMutationEnvelopeLocally } from './post-signed-payload';

export type ProfileSignSnapshot = {
	display_name: string;
	bio?: string;
	avatar_url?: string;
	banner_url?: string;
	metadata?: Record<string, unknown>;
};

function trimOpt(s: string | undefined): string | undefined {
	if (s === undefined) return undefined;
	const t = s.trim();
	return t === '' ? undefined : t;
}

export function buildProfileSignedPayloadV1(params: {
	did: string;
	snapshot: ProfileSignSnapshot;
}): ProfileSignedPayloadV1 {
	const { did, snapshot } = params;
	const display_name = snapshot.display_name.trim();
	if (!display_name) {
		throw new Error('Display name is required to sign a profile update.');
	}

	const base: Record<string, unknown> = {
		type: 'profile@v1',
		did,
		display_name
	};

	const bio = trimOpt(snapshot.bio);
	if (bio !== undefined) base.bio = bio;

	const avatar_url = trimOpt(snapshot.avatar_url);
	if (avatar_url !== undefined) base.avatar_url = avatar_url;

	const banner_url = trimOpt(snapshot.banner_url);
	if (banner_url !== undefined) base.banner_url = banner_url;

	if (snapshot.metadata !== undefined && snapshot.metadata !== null) {
		base.metadata = snapshot.metadata;
	}

	return ProfileSignedPayloadV1Schema.parse(base);
}

export async function signProfileMutationWithRootKey(
	payload: ProfileSignedPayloadV1,
	rootSeed32: Uint8Array,
	identityPublicKeyMultibase: string
): Promise<SignedMutationEnvelope> {
	const p = ProfileSignedPayloadV1Schema.parse(payload);
	const record = { ...p } as unknown as Record<string, unknown>;
	const signature = await signMutationPayload(record, rootSeed32);
	return {
		payload: record,
		signature,
		device_public_key: identityPublicKeyMultibase
	};
}

export async function verifyProfileSignedMutationEnvelopeLocally(
	envelope: SignedMutationEnvelope
): Promise<boolean> {
	return verifySignedMutationEnvelopeLocally(envelope);
}
