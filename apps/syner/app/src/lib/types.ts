export type PersonaDelegation = {
	delegatePublicKey: string;
	platformOrigin: string;
	platformName: string;
	scope: string;
	createdAt: string;
	instanceUrl: string;
};

export type Persona = {
	id: string;
	did: string;
	publicKey: string;
	displayName: string;
	bio?: string;
	avatarUrl?: string;
	bannerUrl?: string;
	/** Public URL where this identity’s “home” lives (optional). */
	identityHostUrl?: string;
	createdAt: string;
	/** File mtime (Unix timestamp) for cache busting */
	avatarMtime?: number;
	bannerMtime?: number;
};
