import type { SyrIdentityManifest } from '@syr-is/types';

export interface RemoteEndpoints {
	profile: string;
	posts: string;
	stories: string;
	uploads: string;
	did_document: string;
	public_following: string | null;
	web_profile: string | null;
}

/** Build endpoints from a resolved manifest. */
export function endpointsFromManifest(manifest: SyrIdentityManifest): RemoteEndpoints {
	return {
		profile: manifest.endpoints.profile,
		posts: manifest.endpoints.posts,
		stories: manifest.endpoints.stories,
		uploads: manifest.endpoints.uploads,
		did_document: manifest.endpoints.did_document,
		public_following: manifest.endpoints.public_following ?? null,
		web_profile: manifest.web_profile ?? null
	};
}

/** Hardcoded fallback when no manifest is available (backward compat). */
export function fallbackEndpoints(providerOrigin: string, did: string): RemoteEndpoints {
	const base = providerOrigin.replace(/\/$/, '');
	const encoded = encodeURIComponent(did);
	return {
		profile: `${base}/api/public/profile/${encoded}`,
		posts: `${base}/api/public/posts/${encoded}`,
		stories: `${base}/api/public/stories/${encoded}`,
		uploads: `${base}/api/public/uploads/${encoded}`,
		did_document: `${base}/api/identity/${encoded}/document`,
		public_following: `${base}/api/public/following/${encoded}`,
		web_profile: `${base}/u/${encoded}`
	};
}

/** Build the conventional manifest URL for a provider + DID. */
export function manifestUrl(providerOrigin: string, did: string): string {
	const base = providerOrigin.replace(/\/$/, '');
	return `${base}/.well-known/syr/${encodeURIComponent(did)}`;
}
