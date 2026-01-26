import { z } from "zod";
import { BaseEntitySchema, RecordIdSchema } from "./common.js";

/**
 * Folder Schema
 * Represents a folder in the user's file storage system
 *
 * Folders are used to organize uploads in a hierarchical structure.
 * The storage path is built by traversing parent folders.
 *
 * Special folder: "public" - files in this folder (and subfolders) are publicly accessible
 * without signed URLs
 */
export const FolderSchema = BaseEntitySchema.extend({
  name: z
    .string()
    .min(1, "Folder name is required")
    .max(255, "Folder name must be 255 characters or less")
    .regex(
      /^[^/\\*?"<>|]+$/,
      'Folder name cannot contain special characters: / \\ * ? " < > |',
    ),
  owner_id: RecordIdSchema,
  parent_id: RecordIdSchema.nullable().optional(),
});

export type Folder = z.infer<typeof FolderSchema>;

/**
 * Folder Create Schema
 * For creating new folders
 */
export const FolderCreateSchema = z.object({
  name: FolderSchema.shape.name,
  parent_id: z.string().nullable().optional(),
});

export type FolderCreate = z.infer<typeof FolderCreateSchema>;

/**
 * Folder Update Schema
 * For updating existing folders
 */
export const FolderUpdateSchema = z.object({
  name: FolderSchema.shape.name.optional(),
  parent_id: z.string().nullable().optional(),
});

export type FolderUpdate = z.infer<typeof FolderUpdateSchema>;

/**
 * Check if a folder name is the special "public" folder
 */
export function isPublicFolder(name: string): boolean {
  return name.toLowerCase() === "public";
}
