import { z } from "zod";
import { BaseEntitySchema, RecordIdSchema } from "./common.js";

export const PostTypeSchema = z.enum(["blog", "media"]);

export type PostType = z.infer<typeof PostTypeSchema>;

export const PostBlogContentTypeSchema = z.enum(["markdown", "html"]);

export type PostBlogContentType = z.infer<typeof PostBlogContentTypeSchema>;

export const PostBlogVisibilityTypeSchema = z.enum([
  "public",
  "unlisted",
  "private",
]);

export type PostBlogVisibilityType = z.infer<
  typeof PostBlogVisibilityTypeSchema
>;

/**
 * Media Display Mode Schema
 * - carousel: Display media in an Embla-based carousel
 * - masonry: Display media in a CSS masonry grid layout
 */
export const MediaDisplayModeSchema = z.enum(["carousel", "masonry"]);

export type MediaDisplayMode = z.infer<typeof MediaDisplayModeSchema>;

/**
 * Post Status Schema
 * - draft: Post is being worked on, uploads go to post_assets folder
 * - completed: Post is finalized and published
 */
export const PostStatusSchema = z.enum(["draft", "completed"]);

export type PostStatus = z.infer<typeof PostStatusSchema>;

export const PostSchema = BaseEntitySchema.extend({
  type: PostTypeSchema,
  content_type: PostBlogContentTypeSchema.optional(),
  title: z.string().optional(),
  description: z.string().max(280).optional(),
  content: z.string().optional(),
  media_urls: z.array(z.string()).optional(),
  display_mode: MediaDisplayModeSchema.optional(),
  visibility: PostBlogVisibilityTypeSchema.default("public"),
  status: PostStatusSchema.default("draft"),
  author_id: RecordIdSchema,
});

export type Post = z.infer<typeof PostSchema>;

export const PostCreateSchema = PostSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  author_id: true,
});

export type PostCreate = z.infer<typeof PostCreateSchema>;

export const PostUpdateSchema = PostSchema.omit({
  created_at: true,
  updated_at: true,
  author_id: true,
});

export type PostUpdate = z.infer<typeof PostUpdateSchema>;
