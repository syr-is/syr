import { z } from 'zod';
import { PublicStorySlideSchema } from '@syr-is/types';

export type StorySlide = z.infer<typeof PublicStorySlideSchema>;

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
