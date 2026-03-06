/**
 * In-memory pub/sub for notifying SSE clients when an identity verification succeeds.
 * Used for both export and import challenge flows.
 */

const exportSubscribers = new Map<string, Set<(token: string) => void>>();
const importSubscribers = new Map<string, Set<(token: string) => void>>();
const deleteAegisSubscribers = new Map<string, Set<(token: string) => void>>();
const deleteAccountSubscribers = new Map<string, Set<(token: string) => void>>();

export function subscribeExport(
	challengeId: string,
	callback: (token: string) => void
): () => void {
	let set = exportSubscribers.get(challengeId);
	if (!set) {
		set = new Set();
		exportSubscribers.set(challengeId, set);
	}
	set.add(callback);
	return () => {
		set?.delete(callback);
		if (set?.size === 0) exportSubscribers.delete(challengeId);
	};
}

export function notifyExportVerified(challengeId: string, exportToken: string): void {
	const set = exportSubscribers.get(challengeId);
	if (set) {
		for (const cb of set) {
			try {
				cb(exportToken);
			} catch (e) {
				console.error('[export-verify-broadcast] callback error:', e);
			}
		}
		exportSubscribers.delete(challengeId);
	}
}

export function subscribeImport(
	challengeId: string,
	callback: (token: string) => void
): () => void {
	let set = importSubscribers.get(challengeId);
	if (!set) {
		set = new Set();
		importSubscribers.set(challengeId, set);
	}
	set.add(callback);
	return () => {
		set?.delete(callback);
		if (set?.size === 0) importSubscribers.delete(challengeId);
	};
}

export function notifyImportVerified(challengeId: string, importToken: string): void {
	const set = importSubscribers.get(challengeId);
	if (set) {
		for (const cb of set) {
			try {
				cb(importToken);
			} catch (e) {
				console.error('[export-verify-broadcast] import callback error:', e);
			}
		}
		importSubscribers.delete(challengeId);
	}
}

export function subscribeDeleteAegis(
	challengeId: string,
	callback: (token: string) => void
): () => void {
	let set = deleteAegisSubscribers.get(challengeId);
	if (!set) {
		set = new Set();
		deleteAegisSubscribers.set(challengeId, set);
	}
	set.add(callback);
	return () => {
		set?.delete(callback);
		if (set?.size === 0) deleteAegisSubscribers.delete(challengeId);
	};
}

export function notifyDeleteAegisVerified(challengeId: string, deleteAegisToken: string): void {
	const set = deleteAegisSubscribers.get(challengeId);
	if (set) {
		for (const cb of set) {
			try {
				cb(deleteAegisToken);
			} catch (e) {
				console.error('[export-verify-broadcast] delete-aegis callback error:', e);
			}
		}
		deleteAegisSubscribers.delete(challengeId);
	}
}

export function subscribeDeleteAccount(
	challengeId: string,
	callback: (token: string) => void
): () => void {
	let set = deleteAccountSubscribers.get(challengeId);
	if (!set) {
		set = new Set();
		deleteAccountSubscribers.set(challengeId, set);
	}
	set.add(callback);
	return () => {
		set?.delete(callback);
		if (set?.size === 0) deleteAccountSubscribers.delete(challengeId);
	};
}

export function notifyDeleteAccountVerified(challengeId: string, deleteAccountToken: string): void {
	const set = deleteAccountSubscribers.get(challengeId);
	if (set) {
		for (const cb of set) {
			try {
				cb(deleteAccountToken);
			} catch (e) {
				console.error('[export-verify-broadcast] delete-account callback error:', e);
			}
		}
		deleteAccountSubscribers.delete(challengeId);
	}
}
