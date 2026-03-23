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
			'Add at least one discovery registry in Settings → Discovery before following remote identities.'
		);
	}

	for (const raw of registryUrls) {
		const trimmed = raw.trim();
		if (trimmed === '') continue;
		let apiRoot: string;
		try {
			apiRoot = registryApiRoot(trimmed);
		} catch {
			continue;
		}
		try {
			await resolveProvider(followedDid, { registryUrl: apiRoot, timeout: 12_000 });
			return { sourceRegistry: trimmed };
		} catch {
			continue;
		}
	}

	throw new Error(
		'This DID is not listed on any of your discovery registries, so it cannot be followed from this account.'
	);
}
