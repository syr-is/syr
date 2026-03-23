import { z } from 'zod';
import { DidSyrSchema } from './common.js';

/**
 * Envelope sent with profile/post mutations when using client-side signing (Option B).
 * `device_public_key` is multibase-encoded; must match a delegated_key row for the identity.
 */
export const SignedMutationEnvelopeSchema = z.object({
	payload: z.record(z.string(), z.any()),
	signature: z.string().min(1),
	device_public_key: z.string().min(1)
});

export type SignedMutationEnvelope = z.infer<typeof SignedMutationEnvelopeSchema>;

/** Canonical profile snapshot signed for profile@v1 */
export const ProfileSignedPayloadV1Schema = z.object({
	type: z.literal('profile@v1'),
	did: DidSyrSchema,
	display_name: z.string().min(1).max(100),
	bio: z.string().max(500).optional(),
	avatar_url: z.url().optional(),
	banner_url: z.url().optional(),
	metadata: z.record(z.string(), z.any()).optional()
});

export type ProfileSignedPayloadV1 = z.infer<typeof ProfileSignedPayloadV1Schema>;

/** Post body fields for signing (create/update) */
export const PostSignedPayloadV1Schema = z.object({
	type: z.literal('post@v1'),
	did: DidSyrSchema,
	post_id: z.string().min(1),
	post_type: z.enum(['blog', 'media']),
	title: z.string().optional(),
	description: z.string().max(280).optional(),
	content: z.string().optional(),
	content_type: z.enum(['markdown', 'html']).optional(),
	media_urls: z.array(z.string()).optional(),
	display_mode: z.enum(['carousel', 'masonry', 'gallery', 'cards']).optional(),
	visibility: z.enum(['public', 'unlisted', 'private']).default('public'),
	status: z.enum(['draft', 'completed']).default('draft'),
	created_at: z.string()
});

export type PostSignedPayloadV1 = z.infer<typeof PostSignedPayloadV1Schema>;

/** Delete post — client signs before DELETE */
export const PostDeleteSignedPayloadV1Schema = z.object({
	type: z.literal('post-delete@v1'),
	did: DidSyrSchema,
	post_id: z.string().min(1)
});

export type PostDeleteSignedPayloadV1 = z.infer<typeof PostDeleteSignedPayloadV1Schema>;
