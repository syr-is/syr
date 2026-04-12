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

/** Atomically consume a pending delegation: get + delete + validate code in one step. */
export async function consumePendingDelegation(
	id: string,
	code: string
): Promise<PendingPlatformDelegation | null> {
	const reg = await kvService.getAndDelete<PendingPlatformDelegation>(KV_TYPE, id);
	if (!reg || reg.code !== code) return null;
	return reg;
}
