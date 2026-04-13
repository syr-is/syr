import { independentLogin } from '$lib/config';
import { kvService } from '$lib/services/kv';

const KV_CHALLENGE_TYPE = 'independent_login_challenge';
const KV_CALLBACK_TYPE = 'independent_login_callback';

/**
 * Stored challenge for independent login.
 */
export interface StoredChallenge {
	nonce: string;
	message: string;
	domain: string;
	created_at: number;
	/** For future invite-only mode */
	invite_code_required?: boolean;
}

/**
 * Store a challenge with TTL expiry.
 */
export async function setChallenge(id: string, challenge: StoredChallenge): Promise<void> {
	await kvService.set(KV_CHALLENGE_TYPE, id, challenge, independentLogin.challengeTtl);
}

/**
 * Retrieve a challenge by ID. Returns null if not found or expired.
 */
export async function getChallenge(id: string): Promise<StoredChallenge | null> {
	return kvService.get<StoredChallenge>(KV_CHALLENGE_TYPE, id);
}

/**
 * Delete a challenge (after verify).
 */
export async function deleteChallenge(id: string): Promise<void> {
	await kvService.delete(KV_CHALLENGE_TYPE, id);
}

/**
 * Store a one-time callback token with JWT after successful verify.
 */
export async function setCallbackToken(token: string, jwt: string): Promise<void> {
	await kvService.set(KV_CALLBACK_TYPE, token, { jwt }, independentLogin.callbackTokenTtl);
}

/**
 * Retrieve and consume a callback token. Returns JWT or null.
 * Uses atomic get-and-delete to prevent TOCTOU race (multiple callers receiving same JWT).
 */
export async function consumeCallbackToken(token: string): Promise<string | null> {
	const entry = await kvService.getAndDelete<{ jwt: string }>(KV_CALLBACK_TYPE, token);
	return entry?.jwt ?? null;
}

// ── Delegation metadata (piggybacked on independent login challenges) ──

const KV_DELEGATION_META_TYPE = 'challenge_delegation_meta';

export interface DelegationMeta {
	delegation_id: string;
	user_id: string;
}

export async function setDelegationMeta(challengeId: string, meta: DelegationMeta): Promise<void> {
	await kvService.set(KV_DELEGATION_META_TYPE, challengeId, meta, independentLogin.challengeTtl);
}

export async function consumeDelegationMeta(challengeId: string): Promise<DelegationMeta | null> {
	return kvService.getAndDelete<DelegationMeta>(KV_DELEGATION_META_TYPE, challengeId);
}
