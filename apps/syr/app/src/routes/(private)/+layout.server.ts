import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getIdentityContext } from '$lib/server/identity-context';
import { delegatedKeyRepository } from '$lib/repositories/identity.repository';
import { signedMutations } from '$lib/config';
import { config } from '$lib/config';
import { safePostLoginRedirectPath } from '$lib/post-login-redirect-path';

export const load: LayoutServerLoad = async ({ locals, url, cookies }) => {
	if (!locals.user) {
		const next = `${url.pathname}${url.search}`;
		const safe = safePostLoginRedirectPath(next);
		if (safe) {
			cookies.set('post_login_redirect', safe, {
				path: '/',
				maxAge: 600,
				sameSite: 'lax',
				httpOnly: false,
				secure: config.NODE_ENV === 'production'
			});
		}
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
