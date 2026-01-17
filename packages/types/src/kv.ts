import { z } from "zod";
import { RecordId } from "surrealdb";
import { BaseEntitySchema, TimestampSchema } from "./common.js";

/**
 * KV (Key-Value) Types
 * Schema definitions for generic key-value storage in SurrealDB
 */

/**
 * KV ID Format Regex
 * Validates the format: kv:type:index
 * - type: alphanumeric with underscores (e.g., "session", "cache", "user_prefs")
 * - index: alphanumeric with underscores, hyphens, and colons (e.g., "abc123", "user:abc123")
 */
export const KV_ID_REGEX = /^kv:[a-zA-Z][a-zA-Z0-9_]*:[a-zA-Z0-9_:-]+$/;

/**
 * KV ID String Schema
 * Validates the string format of a KV ID
 */
export const KvIdStringSchema = z
  .string()
  .regex(KV_ID_REGEX, {
    message:
      "KV ID must be in format 'kv:type:index' (e.g., 'kv:session:abc123')",
  })
  .describe("KV ID string in format kv:type:index");

export type KvIdString = z.infer<typeof KvIdStringSchema>;

/**
 * KV RecordId Schema
 * SurrealDB RecordId instance validation for KV records
 * Ensures the table is 'kv'
 */
export const KvRecordIdSchema = z
  .instanceof(RecordId, {
    message: "Expected a SurrealDB RecordId instance",
  })
  .refine((recordId) => recordId.tb === "kv", {
    message: "KV RecordId must have table 'kv'",
  })
  .describe("KV RecordId");

export type KvRecordId = z.infer<typeof KvRecordIdSchema>;

/**
 * Parse KV ID components from string
 * @param kvId - The KV ID string in format "kv:type:index"
 * @returns Object with type and index components
 */
export function parseKvId(kvId: string): { type: string; index: string } {
  const validation = KvIdStringSchema.safeParse(kvId);
  if (!validation.success) {
    throw new Error(validation.error.issues[0].message);
  }
  // Split only on first two colons (kv:type:rest_including_colons)
  const firstColon = kvId.indexOf(":");
  const secondColon = kvId.indexOf(":", firstColon + 1);
  const type = kvId.slice(firstColon + 1, secondColon);
  const index = kvId.slice(secondColon + 1);
  return { type, index };
}

/**
 * Create KV ID string from components
 * @param type - The type/category of the KV entry
 * @param index - The unique index within the type
 * @returns Formatted KV ID string
 */
export function createKvId(type: string, index: string): KvIdString {
  const kvId = `kv:${type}:${index}`;
  const validation = KvIdStringSchema.safeParse(kvId);
  if (!validation.success) {
    throw new Error(validation.error.issues[0].message);
  }
  return kvId as KvIdString;
}

/**
 * Create KV RecordId from components
 * @param type - The type/category of the KV entry
 * @param index - The unique index within the type
 * @returns SurrealDB RecordId for the KV entry
 */
export function createKvRecordId(type: string, index: string): RecordId {
  // Validate the format first
  createKvId(type, index);
  // Create RecordId with composite key as the id part
  return new RecordId("kv", `${type}:${index}`);
}

/**
 * KV Entry Schema
 * Extends BaseEntitySchema with KV-specific id validation and value field
 * The value field uses z.unknown() to allow any type
 */
export const KvEntrySchema = BaseEntitySchema.extend({
  /** Override id to use KV-specific RecordId validation */
  id: KvRecordIdSchema,
  /** The type/category of the KV entry (extracted from ID for indexing) */
  kv_type: z.string(),
  /** The value stored - can be any JSON-serializable type */
  value: z.unknown(),
  /** Optional TTL (time-to-live) timestamp for automatic expiration */
  expires_at: TimestampSchema.optional(),
});

export type KvEntry = z.infer<typeof KvEntrySchema>;

/**
 * KV Entry Create Schema
 * Schema for creating new KV entries (without auto-generated fields)
 */
export const KvEntryCreateSchema = z.object({
  /** The type/category of the KV entry */
  kv_type: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, {
    message:
      "KV type must start with a letter and contain only alphanumeric characters and underscores",
  }),
  /** The unique index within the type (can contain colons for record IDs like user:abc123) */
  index: z.string().regex(/^[a-zA-Z0-9_:-]+$/, {
    message:
      "Index must contain only alphanumeric characters, underscores, hyphens, and colons",
  }),
  /** The value to store - can be any JSON-serializable type */
  value: z.unknown(),
  /** Optional TTL in seconds */
  ttl_seconds: z.number().int().positive().optional(),
});

export type KvEntryCreate = z.infer<typeof KvEntryCreateSchema>;

/**
 * KV Entry Update Schema
 * Schema for updating existing KV entries
 */
export const KvEntryUpdateSchema = z.object({
  /** The value to store - can be any JSON-serializable type */
  value: z.unknown(),
  /** Optional TTL in seconds (from now) */
  ttl_seconds: z.number().int().positive().optional(),
});

export type KvEntryUpdate = z.infer<typeof KvEntryUpdateSchema>;
