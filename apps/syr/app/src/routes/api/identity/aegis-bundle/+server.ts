import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identityController } from '$lib/controllers/identity.controller';
import type { AegisBundle } from '@syr-is/crypto/aegis';

/**
 * GET /api/identity/aegis-bundle
 *
 * Returns the Aegis bundle for the authenticated user's identity.
 * Used when the client needs to re-unlock (e.g. after page refresh) -
 * fetch bundle, prompt for password, decrypt and store seed.
 *
 * Requires: Authenticated session with an identity that has Aegis.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, {
			code: 'AUTHENTICATION_ERROR',
			message: 'Authentication required'
		});
	}

	const identity = await identityController.getIdentity(locals.user.id);
	if (!identity) {
		throw error(404, {
			code: 'NO_IDENTITY',
			message: 'User has no identity'
		});
	}

	if (
		!identity.aegis_salt ||
		!identity.aegis_nonce ||
		!identity.aegis_ct ||
		!identity.aegis_tag ||
		identity.aegis_kdf_mem == null ||
		identity.aegis_kdf_it == null ||
		identity.aegis_kdf_par == null
	) {
		throw error(404, {
			code: 'NO_AEGIS',
			message: 'Identity has no Aegis bundle'
		});
	}

	const aegisBundle: AegisBundle = {
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

	return json({
		status: 'success',
		data: { aegisBundle },
		meta: { timestamp: new Date().toISOString() }
	});
};
