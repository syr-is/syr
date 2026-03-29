import { SyrIdentityManifestSchema, type SyrIdentityManifest } from '@syr-is/types';

const cache = new Map<string, { manifest: SyrIdentityManifest; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

/**
 * Fetch a per-identity manifest from a manifest URL (server-side).
 * Uses an in-memory cache with a 5-minute TTL.
 * Returns null on any failure (network, invalid schema, timeout).
 */
export async function fetchManifest(
	manifestUrl: string,
	timeoutMs = 8_000
): Promise<SyrIdentityManifest | null> {
	const cached = cache.get(manifestUrl);
	if (cached) {
		if (cached.expiresAt > Date.now()) return cached.manifest;
		cache.delete(manifestUrl);
	}

	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		const res = await fetch(manifestUrl, {
			headers: { Accept: 'application/json' },
			signal: controller.signal
		});
		clearTimeout(timer);

		if (!res.ok) return null;

		const json = await res.json();
		const parsed = SyrIdentityManifestSchema.safeParse(json);
		if (!parsed.success) return null;

		if (cache.size >= MAX_CACHE_ENTRIES) {
			const oldest = cache.keys().next().value;
			if (oldest) cache.delete(oldest);
		}
		cache.set(manifestUrl, { manifest: parsed.data, expiresAt: Date.now() + CACHE_TTL_MS });
		return parsed.data;
	} catch {
		return null;
	}
}
