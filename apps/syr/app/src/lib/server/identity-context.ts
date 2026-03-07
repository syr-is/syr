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
 */
export async function getIdentityContext(userId: string): Promise<IdentityContext> {
	const identity = await identityController.getIdentity(userId);
	const hasIdentity = identity !== null;
	const aegisBundle = buildAegisBundleFromIdentity(identity);
	const hasAegis = !!aegisBundle;

	return {
		identity,
		hasIdentity,
		hasAegis,
		aegisBundle,
		did: identity?.did ?? null
	};
}
