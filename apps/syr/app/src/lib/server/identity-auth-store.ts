import { identityAuth } from '$lib/config';

/**
 * Pending identity-auth challenge.
 * Stored in memory. In production, use a persistent store (Redis, SurrealDB KV, etc.).
 */
export interface PendingChallenge {
	did: string;
	origin: string;
	scopes: string[];
	callback_url: string;
	state?: string;
	user_id: string;
	created_at: number;
	/** Set after user consents — the authorization code */
	code?: string;
}

/**
 * In-memory store for pending identity-auth challenges.
 */
export const pendingChallenges = new Map<string, PendingChallenge>();

/**
 * Remove challenges older than the configured expiry.
 */
export function cleanupExpiredChallenges() {
	const now = Date.now();
	const expiryMs = identityAuth.challengeExpiresIn * 1000;
	for (const [id, challenge] of pendingChallenges) {
		if (now - challenge.created_at > expiryMs) {
			pendingChallenges.delete(id);
		}
	}
}
