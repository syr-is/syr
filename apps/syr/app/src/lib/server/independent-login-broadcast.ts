/**
 * In-memory pub/sub for notifying SSE clients when a challenge is verified.
 * When Syner signs successfully, the verify endpoint calls notifyVerified.
 * The heartbeat SSE pushes the token to any client subscribed to that challenge_id.
 */
type VerifiedCallback = (token: string) => void;

const subscribers = new Map<string, Set<VerifiedCallback>>();

export function subscribe(challengeId: string, callback: VerifiedCallback): () => void {
	let set = subscribers.get(challengeId);
	if (!set) {
		set = new Set();
		subscribers.set(challengeId, set);
	}
	set.add(callback);
	return () => {
		set?.delete(callback);
		if (set?.size === 0) subscribers.delete(challengeId);
	};
}

export function notifyVerified(challengeId: string, token: string): void {
	const set = subscribers.get(challengeId);
	if (!set) return;
	for (const cb of set) {
		try {
			cb(token);
		} catch (e) {
			console.error('[independent-login-broadcast] callback error:', e);
		}
	}
	subscribers.delete(challengeId);
}
