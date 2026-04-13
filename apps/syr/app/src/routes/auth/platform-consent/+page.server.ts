import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getPendingDelegation, setPendingDelegation } from '$lib/server/platform-delegation-store';
import { identityRepository } from '$lib/repositories/identity.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { platformDelegationController } from '$lib/controllers/platform-delegation.controller';
import { config } from '$lib/config';

/**
 * Platform consent page.
 *
 * Two modes:
 * - Aegis (custodial): password form → server signs delegation → redirect
 * - External / no identity: QR deep link → Syner signs → delegation-verify
 *   does all the work → SSE notifies page → auto-redirect to callback
 */
export const load: PageServerLoad = async ({ url, locals }) => {
	if (!locals.user) {
		redirect(302, `/login?redirect=${encodeURIComponent(url.pathname + url.search)}`);
	}

	// Parse registration params (direct redirect or pre-registered challenge)
	let challengeId: string;
	let platformName: string;
	let platformOrigin: string;
	let scopes: string[];
	let callbackUrl: string;
	let state: string | undefined;

	// Resolve identity early — needed for DID in direct-entry branch and Aegis detection
	const identity = await identityRepository.findByUserId(locals.user.id);

	const existingChallengeId = url.searchParams.get('challenge');

	if (existingChallengeId) {
		const reg = await getPendingDelegation(existingChallengeId);
		if (!reg) error(400, { message: 'Challenge not found or expired' });
		if (reg.user_id !== locals.user.id.toString())
			error(403, { message: 'This delegation request is for a different user' });

		challengeId = existingChallengeId;
		platformName = reg.platform_name;
		platformOrigin = reg.platform_origin;
		scopes = reg.scopes;
		callbackUrl = reg.callback_url;
		state = reg.state;
	} else {
		const qOrigin = url.searchParams.get('platform_origin');
		const qCallback = url.searchParams.get('callback_url');
		if (!qOrigin || !qCallback)
			error(400, { message: 'Missing required: platform_origin, callback_url' });

		// Validate callback_url is a valid http(s) URL whose origin matches platform_origin
		let parsedOrigin: URL;
		let parsedCallback: URL;
		try {
			parsedOrigin = new URL(qOrigin);
			parsedCallback = new URL(qCallback);
		} catch {
			error(400, { message: 'Invalid platform_origin or callback_url' });
		}
		if (!['http:', 'https:'].includes(parsedOrigin.protocol)) {
			error(400, { message: 'platform_origin must use http or https' });
		}
		if (!['http:', 'https:'].includes(parsedCallback.protocol)) {
			error(400, { message: 'callback_url must use http or https' });
		}
		if (parsedCallback.origin !== parsedOrigin.origin) {
			error(400, { message: 'callback_url origin must match platform_origin' });
		}

		platformOrigin = qOrigin;
		platformName = url.searchParams.get('platform_name') || parsedOrigin.hostname;
		callbackUrl = qCallback;
		scopes = (url.searchParams.get('scopes') || 'identity:read,profile:read')
			.split(',')
			.map((s) => s.trim());
		state = url.searchParams.get('state') || undefined;

		challengeId = crypto.randomUUID();
		await setPendingDelegation(challengeId, {
			did: identity?.did ?? locals.user.did ?? '',
			platform_origin: platformOrigin,
			platform_name: platformName,
			callback_url: callbackUrl,
			scopes,
			state,
			user_id: locals.user.id.toString(),
			created_at: Date.now()
		});
	}

	// Detect key custody
	const hasAegis = !!(
		identity?.aegis_ct &&
		identity?.aegis_salt &&
		identity?.aegis_nonce &&
		identity?.aegis_tag
	);

	const profile = await profileRepository.findByUserId(locals.user.id);

	return {
		challengeId,
		platformName,
		platformOrigin,
		scopes,
		did: identity?.did || locals.user.did || null,
		displayName: profile?.display_name || locals.user.username,
		avatarUrl: profile?.avatar_url,
		hasAegis,
		instanceUrl: config.PUBLIC_URL
	};
};

export const actions: Actions = {
	/** Aegis-only: password-based approve */
	approve: async ({ request, locals }) => {
		if (!locals.user) error(401, { message: 'Authentication required' });

		const formData = await request.formData();
		const challengeId = formData.get('challenge_id') as string;
		const password = formData.get('password') as string;

		if (!challengeId || !password) error(400, { message: 'Missing challenge_id or password' });

		const reg = await getPendingDelegation(challengeId);
		if (!reg) error(400, { message: 'Challenge expired' });
		if (reg.user_id !== locals.user.id.toString()) error(403, { message: 'Wrong user' });

		const identity = await identityRepository.findByUserId(locals.user.id);
		if (!identity) error(400, { message: 'No identity found' });

		const rootSignFn = platformDelegationController.createAegisRootSignFn(identity, password);

		try {
			await platformDelegationController.createPlatformDelegation({
				userId: locals.user.id,
				did: identity.did,
				platformOrigin: reg.platform_origin,
				platformName: reg.platform_name,
				rootSignFn
			});

			const code = crypto.randomUUID();
			reg.code = code;
			reg.did = identity.did;
			await setPendingDelegation(challengeId, reg);

			const cb = new URL(reg.callback_url);
			cb.searchParams.set('code', code);
			cb.searchParams.set('delegation_id', challengeId);
			if (reg.state) cb.searchParams.set('state', reg.state);
			redirect(302, cb.toString());
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Failed';
			if (msg.includes('decryption') || msg.includes('Aegis'))
				error(400, { message: 'Incorrect password' });
			error(500, { message: msg });
		}
	},

	deny: async ({ request, locals }) => {
		if (!locals.user) error(401, { message: 'Authentication required' });

		const formData = await request.formData();
		const challengeId = formData.get('challenge_id') as string;
		const reg = await getPendingDelegation(challengeId);
		if (!reg) error(400, { message: 'Challenge expired' });
		if (reg.user_id !== locals.user.id.toString()) error(403, { message: 'Wrong user' });

		const cb = new URL(reg.callback_url);
		cb.searchParams.set('error', 'consent_denied');
		if (reg.state) cb.searchParams.set('state', reg.state);
		redirect(302, cb.toString());
	}
};
