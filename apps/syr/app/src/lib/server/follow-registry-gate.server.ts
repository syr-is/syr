import { resolveProvider } from '@syr-is/resolver';
import { registryApiRoot } from '$lib/registry-url';

/**
 * True when `followedDid` resolves on at least one registry the follower has configured.
 */
export async function assertFollowableFromRegistries(
	followedDid: string,
	registryUrls: string[]
): Promise<{ sourceRegistry: string }> {
	if (registryUrls.length === 0) {
		throw new Error(
			'Add at least one identity registry in settings before following remote identities.'
		);
	}

	for (const raw of registryUrls) {
		const registryUrl = registryApiRoot(raw);
		if (!registryUrl) continue;
		try {
			await resolveProvider(followedDid, { registryUrl, timeout: 12_000 });
			return { sourceRegistry: registryUrl };
		} catch {
			continue;
		}
	}

	throw new Error(
		'This DID is not listed on any of your configured registries, so it cannot be followed from this account.'
	);
}
