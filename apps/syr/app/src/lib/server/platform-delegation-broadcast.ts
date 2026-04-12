/**
 * In-memory pub/sub for notifying SSE clients when a delegation signing challenge is completed.
 * When Syner signs the delegation statement, the verify endpoint calls notifyDelegationSigned.
 * The heartbeat SSE pushes the result to the consent page.
 */
type DelegationSignedCallback = (data: {
	signature: string;
	did: string;
	redirect_url?: string;
}) => void;

const subscribers = new Map<string, Set<DelegationSignedCallback>>();

export function subscribeDelegation(
	challengeId: string,
	callback: DelegationSignedCallback
): () => void {
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

export function notifyDelegationSigned(
	challengeId: string,
	data: { signature: string; did: string; redirect_url?: string }
): void {
	const set = subscribers.get(challengeId);
	if (!set) return;
	for (const cb of set) {
		try {
			cb(data);
		} catch (e) {
			console.error('[platform-delegation-broadcast] callback error:', e);
		}
	}
	subscribers.delete(challengeId);
}
