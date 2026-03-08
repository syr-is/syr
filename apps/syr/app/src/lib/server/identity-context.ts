import type { AegisBundle } from '@syr-is/crypto/aegis';
import type { Identity } from '@syr-is/types';
import { identityController } from '$lib/controllers/identity.controller';
import { buildAegisBundleFromIdentity } from '$lib/utils/aegis-bundle.server';

export type IdentityContext = {
	identity: Identity | null;
	hasIdentity: boolean;
	hasAegis: boolean;
	aegisBundle: AegisBundle | undefined;
	did: string | null;
};

/**
 * Centralized identity context for the authenticated user.
 * Single source of truth for custodial (Aegis) vs independent (Syner) identity.
 * When locals is provided, memoizes per userId for the request lifecycle.
 */
export async function getIdentityContext(
	userId: string,
	locals?: { _identityContextCache?: Map<string, IdentityContext> }
): Promise<IdentityContext> {
	if (locals) {
		if (!locals._identityContextCache) {
			locals._identityContextCache = new Map();
		}
		const cached = locals._identityContextCache.get(userId);
		if (cached) return cached;
	}

	const identity = await identityController.getIdentity(userId);
	const hasIdentity = identity !== null;
	const aegisBundle = buildAegisBundleFromIdentity(identity);
	const hasAegis = !!aegisBundle;

	const result: IdentityContext = {
		identity,
		hasIdentity,
		hasAegis,
		aegisBundle,
		did: identity?.did ?? null
	};

	if (locals?._identityContextCache) {
		locals._identityContextCache.set(userId, result);
	}
	return result;
}
