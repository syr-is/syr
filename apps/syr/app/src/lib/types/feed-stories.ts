export type StorySlide = {
	id: string;
	mime_type: string;
	url: string;
	published_at: string;
	width?: number | null;
	height?: number | null;
	duration_seconds?: number | null;
};

export type StoryBundle = {
	did: string;
	provider: string;
	slides: StorySlide[];
	profile: {
		displayName: string;
		username: string;
		avatarUrl: string | null;
		bannerUrl: string | null;
	} | null;
};
