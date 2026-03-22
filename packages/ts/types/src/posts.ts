import { z } from 'zod';
import { BaseEntitySchema, RecordIdSchema, DidSyrSchema } from './common.js';
import { SignedMutationEnvelopeSchema } from './signed-mutations.js';

export const PostTypeSchema = z.enum(['blog', 'media']);

export type PostType = z.infer<typeof PostTypeSchema>;

export const PostBlogContentTypeSchema = z.enum(['markdown', 'html']);

export type PostBlogContentType = z.infer<typeof PostBlogContentTypeSchema>;

export const PostBlogVisibilityTypeSchema = z.enum(['public', 'unlisted', 'private']);

export type PostBlogVisibilityType = z.infer<typeof PostBlogVisibilityTypeSchema>;

/**
 * Media Display Mode Schema
 * - carousel: Display media in an Embla-based carousel
 * - masonry: Display media in a CSS masonry grid layout
 * - gallery: Display media in a uniform grid with a preview modal
 */
export const MediaDisplayModeSchema = z.enum(['carousel', 'masonry', 'gallery', 'cards']);

export type MediaDisplayMode = z.infer<typeof MediaDisplayModeSchema>;

/**
 * Post Status Schema
 * - draft: Post is being worked on, uploads go to post_assets folder
 * - completed: Post is finalized and published
 */
export const PostStatusSchema = z.enum(['draft', 'completed']);

export type PostStatus = z.infer<typeof PostStatusSchema>;

/**
 * Base refinement: media posts must not have content_type set.
 * Used by all schemas including partial-update contexts.
 */
function refineMediaNoContentType(
	data: { type?: string; content_type?: string },
	ctx: z.RefinementCtx
) {
	if (data.type === 'media' && data.content_type != null) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: 'content_type must not be set for media posts',
			path: ['content_type']
		});
	}
}

/**
 * Full refinement: media posts must not have content_type,
 * and blog posts must have content_type.
 * Only used on non-partial schemas (PostSchema, PostCreateSchema)
 * because partial updates may omit content_type legitimately.
 */
function refinePostType(data: { type?: string; content_type?: string }, ctx: z.RefinementCtx) {
	refineMediaNoContentType(data, ctx);
	if (data.type === 'blog' && data.content_type == null) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: 'content_type is required for blog posts',
			path: ['content_type']
		});
	}
}

const PostObjectSchema = BaseEntitySchema.extend({
	type: PostTypeSchema,
	content_type: PostBlogContentTypeSchema.optional(),
	title: z.string().optional(),
	description: z.string().max(280).optional(),
	content: z.string().optional(),
	media_urls: z.array(z.string()).optional(),
	display_mode: MediaDisplayModeSchema.optional(),
	visibility: PostBlogVisibilityTypeSchema.default('public'),
	status: PostStatusSchema.default('draft'),
	author_id: RecordIdSchema,
	/** DID from composite record ID (present when serialized for API) */
	did: DidSyrSchema.optional(),
	/** Local ID/ULID from composite record ID (present when serialized for API) */
	local_id: z.string().optional(),
	content_signature: z.string().optional(),
	signed_payload_json: z.string().optional(),
	signing_device_public_key: z.string().optional()
});

export const PostSchema = PostObjectSchema.superRefine(refinePostType);

export type Post = z.infer<typeof PostSchema>;

export const PostCreateSchema = PostObjectSchema.omit({
	id: true,
	created_at: true,
	updated_at: true,
	author_id: true,
	did: true,
	local_id: true,
	content_signature: true,
	signed_payload_json: true,
	signing_device_public_key: true
}).superRefine(refinePostType);

export type PostCreate = z.infer<typeof PostCreateSchema>;

export const PostUpdateSchema = PostObjectSchema.omit({
	created_at: true,
	updated_at: true,
	author_id: true,
	did: true,
	local_id: true,
	content_signature: true,
	signed_payload_json: true,
	signing_device_public_key: true
}).superRefine(refineMediaNoContentType);

export type PostUpdate = z.infer<typeof PostUpdateSchema>;

export const PostUpdateRequestSchema = PostUpdateSchema.safeExtend({
	signed_mutation: SignedMutationEnvelopeSchema.optional()
});

export type PostUpdateRequest = z.infer<typeof PostUpdateRequestSchema>;

/** PATCH body when post id comes from URL (`/api/posts/[did]/[id]`), not from JSON. */
export const PostUpdateByUrlRequestSchema = PostUpdateSchema.omit({ id: true })
	.partial()
	.safeExtend({
		signed_mutation: SignedMutationEnvelopeSchema.optional()
	});

export type PostUpdateByUrlRequest = z.infer<typeof PostUpdateByUrlRequestSchema>;

/** POST /api/posts — optional client-chosen ULID + signed envelope */
export const PostCreateRequestSchema = PostCreateSchema.safeExtend({
	post_local_id: z.string().min(1).optional(),
	signed_mutation: SignedMutationEnvelopeSchema.optional()
});

export type PostCreateRequest = z.infer<typeof PostCreateRequestSchema>;

export const PostDeleteRequestSchema = z.object({
	signed_mutation: SignedMutationEnvelopeSchema.optional()
});

export type PostDeleteRequest = z.infer<typeof PostDeleteRequestSchema>;
