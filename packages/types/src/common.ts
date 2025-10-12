import { z } from "zod";
import { RecordId } from "surrealdb";

/**
 * Common Base Schemas
 * Reusable schema patterns to reduce redundancy
 */

/**
 * DID Schema (did:web only)
 * Enforces did:web method for sovereignty (DNS-based, no blockchain)
 * Format: did:web:example.com or did:web:example.com:path:to:did
 */
export const DIDSchema = z
  .string()
  .regex(
    /^did:web:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)*$/,
    "Invalid DID format - must be did:web method"
  );

export type DID = z.infer<typeof DIDSchema>;

/**
 * RecordId Schema
 * SurrealDB RecordId instance validation
 */
export const RecordIdSchema = z
  .instanceof(RecordId, {
    message: "Expected a SurrealDB RecordId instance",
  })
  .describe("RecordId");

export type RecordIdType = z.infer<typeof RecordIdSchema>;

/**
 * Timestamp Schema
 * JavaScript Date object validation
 */
export const TimestampSchema = z
  .instanceof(Date, {
    message: "Expected a Date instance",
  })
  .describe("Timestamp");

export type Timestamp = z.infer<typeof TimestampSchema>;

/**
 * Base Entity Schema
 * Common fields for all database entities
 * IDs are RecordId objects, timestamps are Date objects
 */
export const BaseEntitySchema = z.object({
  id: RecordIdSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});

export type BaseEntity = z.infer<typeof BaseEntitySchema>;

/**
 * Base Entity with DID
 * For entities that have a DID
 */
export const BaseEntityWithDIDSchema = BaseEntitySchema.extend({
  did: DIDSchema.optional(),
});

export type BaseEntityWithDID = z.infer<typeof BaseEntityWithDIDSchema>;

/**
 * Metadata Schema
 * Generic metadata object
 */
export const MetadataSchema = z.record(z.string(), z.any());

export type Metadata = z.infer<typeof MetadataSchema>;
