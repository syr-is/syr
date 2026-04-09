import { z } from 'zod';
import { BaseEntitySchema, RecordIdSchema, DidSyrSchema } from './common.js';

/**
 * Emoji Pack Schema
 * Instance-level emoji packs managed by admins (simple auto-ID, not composite)
 */
export const EmojiPackSchema = BaseEntitySchema.extend({
	slug: z
		.string()
		.min(1)
		.max(64)
		.regex(/^[a-z0-9_-]+$/, 'Slug must be lowercase alphanumeric with hyphens/underscores'),
	name: z.string().min(1).max(128),
	description: z.string().max(500).optional(),
	created_by: RecordIdSchema
});

export type EmojiPack = z.infer<typeof EmojiPackSchema>;

export const EmojiPackCreateSchema = EmojiPackSchema.omit({
	id: true,
	created_at: true,
	updated_at: true,
	created_by: true
});

export type EmojiPackCreate = z.infer<typeof EmojiPackCreateSchema>;

export const EmojiPackUpdateSchema = EmojiPackCreateSchema.partial();

export type EmojiPackUpdate = z.infer<typeof EmojiPackUpdateSchema>;

/**
 * Emoji Scope
 */
export const EmojiScopeSchema = z.enum(['instance', 'user']);
export type EmojiScope = z.infer<typeof EmojiScopeSchema>;

/**
 * Emoji Schema
 * Custom emoji or sticker (composite ID: emoji:{ created_by: did, id: ulid })
 */
export const EmojiSchema = BaseEntitySchema.extend({
	shortcode: z
		.string()
		.min(2)
		.max(32)
		.regex(/^[a-zA-Z0-9_]+$/, 'Shortcode must be alphanumeric with underscores'),
	url: z.string().url().optional(),
	mime_type: z.string().min(1),
	size: z.number().int().nonnegative(),
	is_sticker: z.boolean().default(false),
	pack_slug: z.string().optional(),
	scope: EmojiScopeSchema,
	author_id: RecordIdSchema,
	did: DidSyrSchema.optional(),
	local_id: z.string().optional()
});

export type Emoji = z.infer<typeof EmojiSchema>;

export const EmojiCreateSchema = EmojiSchema.omit({
	id: true,
	created_at: true,
	updated_at: true,
	author_id: true,
	did: true,
	local_id: true,
	url: true
});

export type EmojiCreate = z.infer<typeof EmojiCreateSchema>;

export const EmojiCreateRequestSchema = EmojiCreateSchema.extend({
	emoji_local_id: z.string().min(1).optional()
});

export type EmojiCreateRequest = z.infer<typeof EmojiCreateRequestSchema>;
