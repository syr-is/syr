import { fetchManifest } from './manifest-cache.server.js';
import {
	endpointsFromManifest,
	fallbackEndpoints,
	manifestUrl,
	type RemoteEndpoints
} from '$lib/remote-endpoints.js';

/**
 * Resolve the API endpoints for a remote identity.
 *
 * 1. If `identityHostUrl` looks like a manifest URL → fetch it
 * 2. Otherwise try `{providerOrigin}/.well-known/syr/{did}`
 * 3. If a manifest is returned → use its endpoint URLs
 * 4. Otherwise → fall back to hardcoded paths
 */
export async function resolveRemoteEndpoints(
	did: string,
	providerOrigin: string,
	identityHostUrl?: string | null,
	timeoutMs = 8_000
): Promise<RemoteEndpoints> {
	// Try identityHostUrl first if it looks like a manifest URL
	if (identityHostUrl && identityHostUrl.includes('/.well-known/syr/')) {
		const manifest = await fetchManifest(identityHostUrl, timeoutMs);
		if (manifest) return endpointsFromManifest(manifest);
	}

	// Try the conventional manifest location on the provider
	const url = manifestUrl(providerOrigin, did);
	const manifest = await fetchManifest(url, timeoutMs);
	if (manifest) return endpointsFromManifest(manifest);

	// No manifest available — use hardcoded paths
	return fallbackEndpoints(providerOrigin, did);
}
