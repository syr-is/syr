import { z } from "zod";
import { BaseEntitySchema, RecordIdSchema, MetadataSchema } from "./common.js";
import { stringToRecordId } from "./codecs.js";

/**
 * Upload Key Schema
 * Validates the upload key format for file storage paths.
 *
 * Format patterns:
 * - With folder: uploads/{owner_id}/{folder_path}/{table:id}
 * - Without folder (root): uploads/{owner_id}/{table:id}
 * - Post assets: uploads/{owner_id}/public/post_assets/{post_id}/{table:id}
 *
 * Note: folder_path can be nested like "public/images/2024"
 */
export const UploadKeySchema = z
  .string()
  .regex(
    /^uploads\/[^\/]+\/.+$/,
    "Upload key must start with uploads/{owner_id}/"
  )
  .describe("Upload key in format uploads/{owner_id}/[folder_path/]{table:id}");

export type UploadKey = z.infer<typeof UploadKeySchema>;

/**
 * Upload Status Schema
 * Represents the current status of an upload
 */
export const UploadStatusSchema = z.enum([
  "pending",
  "uploading",
  "completed",
  "failed",
  "cancelled",
]);

export type UploadStatus = z.infer<typeof UploadStatusSchema>;

/**
 * Upload Schema
 * Represents a file upload in the SYR system
 * - Pending uploads don't require key or url
 * - Completed uploads require key and url
 * - folder_id references the parent folder (null for root level uploads)
 * - is_public indicates if the file is in the public folder hierarchy
 */
export const UploadSchema = BaseEntitySchema.extend({
  key: UploadKeySchema.optional(),
  owner_id: RecordIdSchema,
  folder_id: RecordIdSchema.nullable().optional(),
  filename: z.string().min(1),
  mime_type: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  url: z.url().optional(),
  status: UploadStatusSchema.default("pending"),
  is_public: z.boolean().default(false),
  metadata: MetadataSchema.optional(),
}).refine(
  (data) => {
    // Pending uploads don't require key or url
    if (data.status === "pending") {
      return true;
    }
    // Completed uploads require key and url
    if (data.status === "completed") {
      return !!data.key && !!data.url;
    }
    // Other statuses (uploading, failed, cancelled) may or may not have key/url
    return true;
  },
  {
    message: "Completed uploads must have both key and url",
    path: ["key"], // Error will be shown on key field
  }
);

export type Upload = z.infer<typeof UploadSchema>;

/**
 * Upload Create Schema
 * For creating new uploads
 * Pending uploads don't require key or url
 * folder_id can be provided as a string ID
 */
export const UploadCreateSchema = z.object({
  filename: z.string().min(1),
  mime_type: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  metadata: MetadataSchema.optional(),
  folder_id: z.string().nullable().optional(),
});

export type UploadCreate = z.infer<typeof UploadCreateSchema>;

/**
 * Upload Update Schema
 * For updating existing uploads
 * Uses stringToRecordId codec to accept string IDs from JSON requests
 */
export const UploadUpdateSchema = z.object({
  id: stringToRecordId,
  status: z.enum(["completed"]),
});

export type UploadUpdate = z.infer<typeof UploadUpdateSchema>;
