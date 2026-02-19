import type { AegisBundle } from '@syr-is/crypto/aegis';
import type { Identity } from '@syr-is/types';

/**
 * Build an Aegis bundle from an Identity record if it has all required Aegis fields.
 * Returns undefined when the identity does not have a complete Aegis bundle.
 */
export function buildAegisBundleFromIdentity(identity: Identity | null): AegisBundle | undefined {
	if (
		!identity?.aegis_salt ||
		!identity?.aegis_nonce ||
		!identity?.aegis_ct ||
		!identity?.aegis_tag ||
		identity.aegis_kdf_mem == null ||
		identity.aegis_kdf_it == null ||
		identity.aegis_kdf_par == null
	) {
		return undefined;
	}
	return {
		pub: identity.public_key,
		salt: identity.aegis_salt,
		nonce: identity.aegis_nonce,
		ct: identity.aegis_ct,
		tag: identity.aegis_tag,
		kdf: {
			mem: identity.aegis_kdf_mem,
			it: identity.aegis_kdf_it,
			par: identity.aegis_kdf_par
		}
	};
}
