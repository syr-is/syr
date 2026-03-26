import { invoke } from '@tauri-apps/api/core';
import { fetch } from '@tauri-apps/plugin-http';

/**
 * Sync persona profile (display_name, bio, avatar, banner) to SYR provisioner.
 * Uses tauri-plugin-http fetch so requests succeed in Tauri/WebView (avoids CORS/fetch failures).
 * Auth: Ed25519 signature over payload (no JWT). Server looks up user by DID.
 */
export async function syncProfileToSyr(
	instanceBase: string,
	personaId: string,
	persona: { displayName: string; bio?: string; did: string; identityHostUrl?: string },
	options: { signature: string; signedPayload: string }
): Promise<void> {
	const formData = new FormData();
	formData.set('did', persona.did);
	formData.set('signature', options.signature);
	formData.set('signed_payload', options.signedPayload);
	if (persona.displayName) formData.set('display_name', persona.displayName);
	if (persona.bio) formData.set('bio', persona.bio);

	const [avatarData, bannerData] = await Promise.all([
		invoke<[string, string] | null>('read_persona_asset_cmd', {
			personaId,
			role: 'avatar'
		}),
		invoke<[string, string] | null>('read_persona_asset_cmd', {
			personaId,
			role: 'banner'
		})
	]);

	if (avatarData) {
		const [base64, mime] = avatarData;
		const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
		formData.set('avatar', new Blob([bytes], { type: mime }), 'avatar');
	}
	if (bannerData) {
		const [base64, mime] = bannerData;
		const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
		formData.set('banner', new Blob([bytes], { type: mime }), 'banner');
	}

	const base = instanceBase.replace(/\/$/, '');
	const res = await fetch(`${base}/api/auth/independent-login/profile-sync`, {
		method: 'POST',
		body: formData
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		const msg = err.message ?? `Profile sync failed: ${res.status}`;
		throw new Error(msg);
	}
}
