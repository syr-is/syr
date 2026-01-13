import { z } from "zod";
import { BaseEntitySchema, RecordIdSchema, MetadataSchema } from "./common.js";

export const PostTypeSchema = z.enum(["blog"]);

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

export const PostSchema = BaseEntitySchema.extend({
  type: PostTypeSchema,
  content_type: PostBlogContentTypeSchema,
  title: z.string().optional(),
  content: z.string().optional(),
  visibility: PostBlogVisibilityTypeSchema.default("public"),
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
