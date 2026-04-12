import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/config';
import type { SyrInstanceManifest } from '@syr-is/types';

/**
 * Instance discovery endpoint. Returns instance-level metadata including
 * public API base paths, identity manifest template, and Syner endpoint
 * URL templates for operational flows.
 *
 * URL templates use `{id}` as a placeholder for dynamic path segments
 * (challenge IDs, session IDs).
 */
export const GET: RequestHandler = async () => {
	const base = config.PUBLIC_URL.replace(/\/$/, '');
	const manifest: SyrInstanceManifest = {
		name: 'syr',
		public_url: base,
		api: {
			public_profile: `${base}/api/public/profile`,
			public_posts: `${base}/api/public/posts`,
			public_stories: `${base}/api/public/stories`,
			public_uploads: `${base}/api/public/uploads`,
			public_following: `${base}/api/public/following`,
			public_emojis: `${base}/api/public/emojis`,
			public_gifs: `${base}/api/public/gifs`
		},
		identity_manifest_template: `${base}/.well-known/syr/{did}`,
		syner: {
			independent_login_challenge: `${base}/api/auth/independent-login/challenge/{id}`,
			independent_login_verify: `${base}/api/auth/independent-login/verify`,
			profile_sync: `${base}/api/auth/independent-login/profile-sync`,
			export_challenge: `${base}/api/identity/export-challenge/{id}`,
			export_verify: `${base}/api/identity/export-verify`,
			export_signatures: `${base}/api/identity/export-signatures`,
			sigil_handoff_payload: `${base}/api/user/sigil-handoff/{id}/payload`,
			post_sign_payload: `${base}/api/user/post-sign/{id}/payload`,
			post_sign_signature: `${base}/api/user/post-sign/{id}/signature`,
			registry_sign_payload: `${base}/api/user/registry-sign/{id}/payload`,
			registry_sign_signature: `${base}/api/user/registry-sign/{id}/signature`,
			delegation_challenge_payload: `${base}/api/platform/delegation-challenge/{id}/payload`,
			delegation_verify: `${base}/api/platform/delegation-verify`
		}
	};
	return json(manifest, {
		headers: {
			'Cache-Control': 'public, max-age=300'
		}
	});
};
