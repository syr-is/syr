import { z } from 'zod';
import { DidSyrSchema } from './common.js';

/**
 * One slide in a public profile story reel (last 24h on the authoring instance).
 */
export const PublicStorySlideSchema = z.object({
	id: z.string().min(1),
	mime_type: z.string().min(1),
	url: z.url(),
	published_at: z.string().datetime(),
	width: z.number().int().positive().optional().nullable(),
	height: z.number().int().positive().optional().nullable(),
	duration_seconds: z.number().nonnegative().optional().nullable()
});

export type PublicStorySlide = z.infer<typeof PublicStorySlideSchema>;

export const PublicStoriesResponseSchema = z.object({
	did: DidSyrSchema,
	slides: z.array(PublicStorySlideSchema)
});

export type PublicStoriesResponse = z.infer<typeof PublicStoriesResponseSchema>;
