import { identityAuth } from '$lib/config';
import { kvService } from '$lib/services/kv';

const KV_TYPE = 'identity_auth_challenge';

/**
 * Pending identity-auth challenge.
 * Persisted in SurrealDB via the KV service with automatic TTL expiry.
 */
export interface PendingChallenge {
	did: string;
	origin: string;
	scopes: string[];
	callback_url: string;
	state?: string;
	user_id: string;
	created_at: number;
	/** Set after user consents -- the authorization code */
	code?: string;
}

/**
 * Store a pending challenge with automatic TTL expiry.
 */
export async function setPendingChallenge(id: string, challenge: PendingChallenge): Promise<void> {
	await kvService.set(KV_TYPE, id, challenge, identityAuth.challengeExpiresIn);
}

/**
 * Retrieve a pending challenge by ID. Returns null if not found or expired.
 */
export async function getPendingChallenge(id: string): Promise<PendingChallenge | null> {
	return kvService.get<PendingChallenge>(KV_TYPE, id);
}

/**
 * Delete a pending challenge (e.g. after code exchange).
 */
export async function deletePendingChallenge(id: string): Promise<void> {
	await kvService.delete(KV_TYPE, id);
}

/**
 * Find the challenge that issued a given authorization code.
 * Returns [challengeId, challenge] or null if not found.
 */
export async function findChallengeByCode(
	code: string
): Promise<[string, PendingChallenge] | null> {
	const entries = await kvService.getByType(KV_TYPE);
	for (const entry of entries) {
		const challenge = entry.value as PendingChallenge;
		if (challenge?.code === code) {
			const parts = String(entry.id).split(':');
			const index = parts[parts.length - 1];
			return [index, challenge];
		}
	}
	return null;
}
