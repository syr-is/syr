import { platformDelegation } from '$lib/config';
import { kvService } from '$lib/services/kv';

const KV_TYPE = 'platform_delegation';

/**
 * Pending platform delegation request.
 * Persisted in SurrealDB via the KV service with automatic TTL expiry.
 */
export interface PendingPlatformDelegation {
	did: string;
	platform_origin: string;
	platform_name: string;
	callback_url: string;
	scopes: string[];
	state?: string;
	user_id: string;
	created_at: number;
	/** Set after user consents — the authorization code */
	code?: string;
}

export async function setPendingDelegation(
	id: string,
	delegation: PendingPlatformDelegation
): Promise<void> {
	await kvService.set(KV_TYPE, id, delegation, platformDelegation.registrationExpiresIn);
}

export async function getPendingDelegation(id: string): Promise<PendingPlatformDelegation | null> {
	return kvService.get<PendingPlatformDelegation>(KV_TYPE, id);
}

export async function deletePendingDelegation(id: string): Promise<void> {
	await kvService.delete(KV_TYPE, id);
}

// ── Pre-generated delegate keypair (Round 1 → Round 2 handoff) ──

const KV_KEYPAIR_TYPE = 'platform_delegation_keypair';
const KV_CHALLENGE_TYPE = 'platform_delegation_sign';

/** Pre-generated delegate keypair stored between Round 1 (challenge) and Round 2 (verify). */
export interface PendingDelegateKeypair {
	delegation_id: string;
	delegate_public_key_multibase: string;
	aegis_delegate: unknown; // AegisBundle — encrypted delegate private key
	canonical_statement: string;
	did: string;
	platform_origin: string;
	platform_name: string;
	created_at: number;
}

export async function setPendingKeypair(
	id: string,
	keypair: PendingDelegateKeypair
): Promise<void> {
	await kvService.set(KV_KEYPAIR_TYPE, id, keypair, platformDelegation.registrationExpiresIn);
}

export async function consumePendingKeypair(id: string): Promise<PendingDelegateKeypair | null> {
	return kvService.getAndDelete<PendingDelegateKeypair>(KV_KEYPAIR_TYPE, id);
}

/** Challenge stored for Syner signing — consumed atomically on verify. */
export interface StoredDelegationChallenge {
	message: string;
	delegation_id: string;
	user_id: string;
	created_at: number;
}

export async function setDelegationChallenge(
	id: string,
	challenge: StoredDelegationChallenge
): Promise<void> {
	await kvService.set(KV_CHALLENGE_TYPE, id, challenge, platformDelegation.registrationExpiresIn);
}

export async function getDelegationChallenge(
	id: string
): Promise<StoredDelegationChallenge | null> {
	return kvService.get<StoredDelegationChallenge>(KV_CHALLENGE_TYPE, id);
}

export async function consumeDelegationChallenge(
	id: string
): Promise<StoredDelegationChallenge | null> {
	return kvService.getAndDelete<StoredDelegationChallenge>(KV_CHALLENGE_TYPE, id);
}

/** Consume a pending delegation: validate all fields before deleting. */
export async function consumePendingDelegation(
	id: string,
	code: string,
	opts?: { platform_origin?: string; callback_url?: string }
): Promise<PendingPlatformDelegation | null> {
	const reg = await kvService.get<PendingPlatformDelegation>(KV_TYPE, id);
	if (!reg || reg.code !== code) return null;
	if (opts?.platform_origin && reg.platform_origin !== opts.platform_origin) return null;
	if (opts?.callback_url && reg.callback_url !== opts.callback_url) return null;
	await kvService.delete(KV_TYPE, id);
	return reg;
}
