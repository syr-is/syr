import { z } from 'zod';
import { RecordId } from 'surrealdb';

/**
 * Common Base Schemas
 * Reusable schema patterns to reduce redundancy
 */

/**
 * RecordId Schema
 * SurrealDB RecordId instance validation
 */
export const RecordIdSchema = z
	.instanceof(RecordId, {
		message: 'Expected a SurrealDB RecordId instance'
	})
	.describe('RecordId');

export type RecordIdType = z.infer<typeof RecordIdSchema>;

/**
 * Timestamp Schema
 * JavaScript Date object validation
 */
export const TimestampSchema = z
	.instanceof(Date, {
		message: 'Expected a Date instance'
	})
	.describe('Timestamp');

export type Timestamp = z.infer<typeof TimestampSchema>;

/**
 * Base Entity Schema
 * Common fields for all database entities
 * IDs are RecordId objects, timestamps are Date objects
 */
export const BaseEntitySchema = z.object({
	id: RecordIdSchema,
	created_at: TimestampSchema,
	updated_at: TimestampSchema
});

export type BaseEntity = z.infer<typeof BaseEntitySchema>;

/**
 * Metadata Schema
 * Generic metadata object
 */
export const MetadataSchema = z.record(z.string(), z.any());

export type Metadata = z.infer<typeof MetadataSchema>;

/**
 * DID Syr Schema
 * Validates a did:syr identifier format.
 * The method-specific identifier is a multibase base58btc-encoded Ed25519 public key.
 */
export const DidSyrSchema = z
	.string()
	.regex(
		/^did:syr:z[1-9A-HJ-NP-Za-km-z]+$/,
		'Must be a valid did:syr identifier (e.g., did:syr:z6Mkt9...)'
	)
	.describe('did:syr identifier');

export type DidSyr = z.infer<typeof DidSyrSchema>;
