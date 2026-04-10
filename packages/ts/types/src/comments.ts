import { z } from 'zod';
import { BaseEntitySchema, RecordIdSchema, DidSyrSchema } from './common.js';
import { SignedMutationEnvelopeSchema } from './signed-mutations.js';

/**
 * Comment Visibility
 */
export const CommentVisibilitySchema = z.enum(['public', 'unlisted', 'private']);
export type CommentVisibility = z.infer<typeof CommentVisibilitySchema>;

/**
 * Comment Status
 */
export const CommentStatusSchema = z.enum(['draft', 'completed']);
export type CommentStatus = z.infer<typeof CommentStatusSchema>;

/**
 * Comment Schema
 * Threaded comment with ancestor chain (composite ID: comment:{ created_by: did, id: ulid })
 *
 * Every comment belongs to a post (post_did + post_id).
 * Root comments have an empty ancestor_chain.
 * Nested comments store the full path from root comment to immediate parent in ancestor_chain,
 * where each entry is a "did:local_id" string identifying a comment in the chain.
 */
export const CommentSchema = BaseEntitySchema.extend({
	/** DID of the post author */
	post_did: z.string().min(1),
	/** ULID of the post */
	post_id: z.string().min(1),
	/** Ordered ancestor chain from root comment to immediate parent.
	 *  Each entry is "did:local_id". Empty for root comments. */
	ancestor_chain: z.array(z.string()).default([]),
	content: z.string().min(1),
	visibility: CommentVisibilitySchema.default('public'),
	status: CommentStatusSchema.default('completed'),
	author_id: RecordIdSchema,
	did: DidSyrSchema.optional(),
	local_id: z.string().optional(),
	content_signature: z.string().optional(),
	signed_payload_json: z.string().optional(),
	signing_device_public_key: z.string().optional()
});

export type Comment = z.infer<typeof CommentSchema>;

export const CommentCreateSchema = CommentSchema.omit({
	id: true,
	created_at: true,
	updated_at: true,
	author_id: true,
	did: true,
	local_id: true,
	content_signature: true,
	signed_payload_json: true,
	signing_device_public_key: true
});

export type CommentCreate = z.infer<typeof CommentCreateSchema>;

export const CommentCreateRequestSchema = CommentCreateSchema.extend({
	comment_local_id: z.string().min(1).optional(),
	signed_mutation: SignedMutationEnvelopeSchema.optional()
});

export type CommentCreateRequest = z.infer<typeof CommentCreateRequestSchema>;

export const CommentUpdateByUrlRequestSchema = CommentSchema.pick({
	content: true,
	visibility: true,
	status: true,
	content_signature: true,
	signed_payload_json: true,
	signing_device_public_key: true
})
	.partial()
	.extend({
		signed_mutation: SignedMutationEnvelopeSchema.optional()
	});

export type CommentUpdateByUrlRequest = z.infer<typeof CommentUpdateByUrlRequestSchema>;

export const CommentDeleteRequestSchema = z.object({
	signed_mutation: SignedMutationEnvelopeSchema.optional()
});

export type CommentDeleteRequest = z.infer<typeof CommentDeleteRequestSchema>;
