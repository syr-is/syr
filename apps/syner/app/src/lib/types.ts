export type Persona = {
	id: string;
	did: string;
	publicKey: string;
	displayName: string;
	bio?: string;
	avatarUrl?: string;
	bannerUrl?: string;
	createdAt: string;
	/** File mtime (Unix timestamp) for cache busting */
	avatarMtime?: number;
	bannerMtime?: number;
};
