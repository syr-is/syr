import { resolveProvider } from '@syr-is/resolver';
import { stringToRecordId } from '@syr-is/types';
import { discoveryRegistryRepository } from '$lib/repositories/discovery-registry.repository';
import { instanceDiscoveryRegistryRepository } from '$lib/repositories/instance-discovery-registry.repository';
import { registryApiRoot } from '$lib/registry-url';

const RESOLVE_BATCH = 3;

function pushUniqueRoots(urls: Iterable<string>, seen: Set<string>, out: string[]) {
	for (const raw of urls) {
		try {
			const root = registryApiRoot(raw);
			if (!seen.has(root)) {
				seen.add(root);
				out.push(root);
			}
		} catch {
			/* skip invalid */
		}
	}
}

/** Registry API roots configured for the whole instance (admin). */
export async function getInstanceDiscoveryBases(): Promise<string[]> {
	const rows = await instanceDiscoveryRegistryRepository.findAll();
	const seen = new Set<string>();
	const out: string[] = [];
	pushUniqueRoots(
		rows.map((r) => r.registry_url),
		seen,
		out
	);
	return out;
}

/**
 * Merged registry API roots: user's discovery list first, then instance list, deduped.
 */
export async function getMergedDiscoveryBases(opts: { userId?: string }): Promise<string[]> {
	const seen = new Set<string>();
	const out: string[] = [];

	if (opts.userId) {
		const uid = stringToRecordId.decode(opts.userId);
		const userRows = await discoveryRegistryRepository.findByUserId(uid);
		pushUniqueRoots(
			userRows.map((r) => r.registry_url),
			seen,
			out
		);
	}

	const instRows = await instanceDiscoveryRegistryRepository.findAll();
	pushUniqueRoots(
		instRows.map((r) => r.registry_url),
		seen,
		out
	);

	return out;
}

/** First registry that resolves the DID to a provider base URL (normalized, no trailing slash). */
export async function resolveProviderWithBases(
	did: string,
	bases: string[],
	timeoutMs: number
): Promise<string | null> {
	for (let i = 0; i < bases.length; i += RESOLVE_BATCH) {
		const chunk = bases.slice(i, i + RESOLVE_BATCH);
		const settled = await Promise.allSettled(
			chunk.map((b) => resolveProvider(did, { registryUrl: b, timeout: timeoutMs }))
		);
		for (const s of settled) {
			if (s.status === 'fulfilled') {
				return s.value.replace(/\/$/, '');
			}
		}
	}
	return null;
}
