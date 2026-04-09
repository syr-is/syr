import { z } from 'zod';
import { BaseEntitySchema, RecordIdSchema, DidSyrSchema } from './common.js';
import { SignedMutationEnvelopeSchema } from './signed-mutations.js';

/**
 * Reaction Kind
 */
export const ReactionKindSchema = z.enum(['unicode', 'custom_emoji', 'sticker', 'gif']);
export type ReactionKind = z.infer<typeof ReactionKindSchema>;

/**
 * Reaction Parent Type
 */
export const ReactionParentTypeSchema = z.enum(['post', 'comment']);
export type ReactionParentType = z.infer<typeof ReactionParentTypeSchema>;

/**
 * Reaction Schema
 * Emoji/sticker/GIF reaction on a post or comment (composite ID: reaction:{ created_by: did, id: ulid })
 */
export const ReactionSchema = BaseEntitySchema.extend({
	parent_type: ReactionParentTypeSchema,
	parent_did: DidSyrSchema,
	parent_id: z.string().min(1),
	kind: ReactionKindSchema,
	value: z.string().min(1),
	image_url: z.string().url().optional(),
	author_id: RecordIdSchema,
	did: DidSyrSchema.optional(),
	local_id: z.string().optional(),
	content_signature: z.string().optional(),
	signed_payload_json: z.string().optional(),
	signing_device_public_key: z.string().optional()
});

export type Reaction = z.infer<typeof ReactionSchema>;

export const ReactionCreateSchema = ReactionSchema.omit({
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

export type ReactionCreate = z.infer<typeof ReactionCreateSchema>;

export const ReactionCreateRequestSchema = ReactionCreateSchema.extend({
	signed_mutation: SignedMutationEnvelopeSchema.optional()
});

export type ReactionCreateRequest = z.infer<typeof ReactionCreateRequestSchema>;

export const ReactionDeleteRequestSchema = z.object({
	signed_mutation: SignedMutationEnvelopeSchema.optional()
});

export type ReactionDeleteRequest = z.infer<typeof ReactionDeleteRequestSchema>;
