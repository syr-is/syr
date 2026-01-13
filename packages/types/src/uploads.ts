import { z } from "zod";
import { BaseEntitySchema, RecordIdSchema, MetadataSchema } from "./common.js";
import { stringToRecordId } from "./codecs.js";

/**
 * Upload Key Schema
 * Validates the upload key format: uploads/{owner_id}/{yyyy}/{mm}/{table:id}
 * Uses full SurrealDB RecordId format (table:id)
 */
export const UploadKeySchema = z
  .string()
  .regex(
    /^uploads\/[^\/]+\/\d{4}\/\d{2}\/[^:]+:[^\/]+$/,
    "Upload key must match format: uploads/{owner_id}/{yyyy}/{mm}/{table:id}"
  )
  .describe("Upload key in format uploads/{owner_id}/{yyyy}/{mm}/{table:id}");

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
 */
export const UploadSchema = BaseEntitySchema.extend({
  key: UploadKeySchema.optional(),
  owner_id: RecordIdSchema,
  filename: z.string().min(1),
  mime_type: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  url: z.url().optional(),
  status: UploadStatusSchema.default("pending"),
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
 */
export const UploadCreateSchema = UploadSchema.pick({
  filename: true,
  mime_type: true,
  size: true,
  sha256: true,
  metadata: true,
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
