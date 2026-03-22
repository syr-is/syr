import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getIdentityContext } from '$lib/server/identity-context';
import { delegatedKeyRepository } from '$lib/repositories/identity.repository';
import { signedMutations } from '$lib/config';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(303, '/login');
	}

	const ctx = await getIdentityContext(locals.user.id, locals);
	const delegated = ctx.did ? await delegatedKeyRepository.findActiveByDid(ctx.did) : [];
	const identityContext = {
		hasIdentity: ctx.hasIdentity,
		hasAegis: ctx.hasAegis,
		did: ctx.did,
		identityPublicKey: ctx.identity?.public_key ?? null,
		requireSignedMutations: signedMutations.requireSigned,
		hasDelegatedDeviceKeys: delegated.length > 0
	};

	return {
		user: locals.user,
		identityContext
	};
};
