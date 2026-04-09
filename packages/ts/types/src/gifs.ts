import { z } from 'zod';
import { BaseEntitySchema, RecordIdSchema, DidSyrSchema } from './common.js';

/**
 * GIF Scope
 */
export const GifScopeSchema = z.enum(['instance', 'user']);
export type GifScope = z.infer<typeof GifScopeSchema>;

/**
 * GIF Schema
 * Self-hosted GIF entry (composite ID: gif:{ created_by: did, id: ulid })
 */
export const GifSchema = BaseEntitySchema.extend({
	url: z.string().url(),
	thumbnail_url: z.string().url().optional(),
	mime_type: z.string().min(1),
	size: z.number().int().nonnegative(),
	scope: GifScopeSchema,
	tags: z.array(z.string()).default([]),
	author_id: RecordIdSchema,
	did: DidSyrSchema.optional(),
	local_id: z.string().optional()
});

export type Gif = z.infer<typeof GifSchema>;

export const GifCreateSchema = GifSchema.omit({
	id: true,
	created_at: true,
	updated_at: true,
	author_id: true,
	did: true,
	local_id: true,
	thumbnail_url: true
});

export type GifCreate = z.infer<typeof GifCreateSchema>;

export const GifCreateRequestSchema = GifCreateSchema.extend({
	gif_local_id: z.string().min(1).optional()
});

export type GifCreateRequest = z.infer<typeof GifCreateRequestSchema>;
