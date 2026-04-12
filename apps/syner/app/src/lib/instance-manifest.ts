import { SyrInstanceManifestSchema, type SyrInstanceManifest } from '@syr-is/types';

const cache = new Map<string, { manifest: SyrInstanceManifest; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch the instance-level manifest from `{instanceUrl}/.well-known/syr`.
 * Caches results in memory for 5 minutes. Returns null on failure.
 */
export async function fetchInstanceManifest(
	instanceUrl: string,
	timeoutMs = 8_000
): Promise<SyrInstanceManifest | null> {
	const base = instanceUrl.replace(/\/$/, '');
	const url = `${base}/.well-known/syr`;

	const cached = cache.get(url);
	if (cached && cached.expiresAt > Date.now()) return cached.manifest;

	try {
		const res = await fetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (!res.ok) return null;

		const json = await res.json();
		const parsed = SyrInstanceManifestSchema.safeParse(json);
		if (!parsed.success) return null;

		cache.set(url, { manifest: parsed.data, expiresAt: Date.now() + CACHE_TTL_MS });
		return parsed.data;
	} catch {
		return null;
	}
}

/**
 * Resolve a Syner endpoint URL template from the instance manifest,
 * replacing `{id}` with the given value. Falls back to the hardcoded
 * default path if the manifest is unavailable.
 */
export async function resolveSynerEndpoint(
	instanceUrl: string,
	endpointKey: keyof NonNullable<SyrInstanceManifest['syner']>,
	id?: string
): Promise<string> {
	const manifest = await fetchInstanceManifest(instanceUrl);
	const base = instanceUrl.replace(/\/$/, '');

	if (manifest?.syner) {
		const template = manifest.syner[endpointKey];
		if (template) {
			return id ? template.replace('{id}', encodeURIComponent(id)) : template;
		}
	}

	// Fallback to hardcoded paths for providers without manifest
	const fallbacks: Record<keyof NonNullable<SyrInstanceManifest['syner']>, string> = {
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
	};

	const template = fallbacks[endpointKey];
	return id ? template.replace('{id}', encodeURIComponent(id)) : template;
}
