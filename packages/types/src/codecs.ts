import { z } from 'zod';
import { RecordId } from 'surrealdb';
import { ulid } from 'ulid';

/**
 * Zod Codecs
 * Bi-directional transformations for data serialization/deserialization
 * Based on Zod v4 codec patterns: https://zod.dev/codecs
 */

/**
 * SurrealDB RecordId Codec
 * Converts strings to RecordId objects for database storage
 * Format: "table:id" (e.g., "user:abc123", "profile:xyz789")
 * Network (string) -> decode -> RecordId (DB)
 * DB (RecordId) -> encode -> string (Network)
 */
export const stringToRecordId = z.codec(z.string(), z.instanceof(RecordId), {
	decode: (str) => {
		const [table, id] = str.split(':');
		return new RecordId(table, id);
	},
	encode: (recordId) => recordId.toString()
});

/**
 * String to Number Codec
 * Converts string representations of numbers to JavaScript number type
 */
export const stringToNumber = z.codec(z.string(), z.number(), {
	decode: (str) => Number(str),
	encode: (num) => num.toString()
});

/**
 * String to Integer Codec
 * Converts string representations of integers to JavaScript number type
 */
export const stringToInt = z.codec(z.string().regex(/^-?\d+$/), z.int(), {
	decode: (str) => Number.parseInt(str, 10),
	encode: (num) => num.toString()
});

/**
 * String to BigInt Codec
 * Converts string representations to JavaScript bigint type
 */
export const stringToBigInt = z.codec(z.string(), z.bigint(), {
	decode: (str) => BigInt(str),
	encode: (bigint) => bigint.toString()
});

/**
 * Number to BigInt Codec
 * ⚠️ Only use for values within Number.MAX_SAFE_INTEGER range
 * For large integers over HTTP, use stringToBigInt instead
 */
export const numberToBigInt = z.codec(z.int(), z.bigint(), {
	decode: (num) => BigInt(num),
	encode: (bigint) => {
		const num = Number(bigint);
		if (num > Number.MAX_SAFE_INTEGER || num < Number.MIN_SAFE_INTEGER) {
			throw new Error('BigInt value exceeds safe integer range');
		}
		return num;
	}
});

/**
 * ISO Datetime to Date Codec
 * Converts ISO datetime strings to JavaScript Date objects
 * This is the primary codec for handling dates in the SYR platform
 */
export const isoDatetimeToDate = z.codec(z.iso.datetime(), z.date(), {
	decode: (isoString) => new Date(isoString),
	encode: (date) => date.toISOString()
});

/**
 * Epoch Seconds to Date Codec
 * Converts Unix timestamps (seconds since epoch) to JavaScript Date objects
 */
export const epochSecondsToDate = z.codec(z.int().min(0), z.date(), {
	decode: (seconds) => new Date(seconds * 1000),
	encode: (date) => Math.floor(date.getTime() / 1000)
});

/**
 * Epoch Milliseconds to Date Codec
 * Converts Unix timestamps (milliseconds since epoch) to JavaScript Date objects
 */
export const epochMillisToDate = z.codec(z.int().min(0), z.date(), {
	decode: (millis) => new Date(millis),
	encode: (date) => date.getTime()
});

/**
 * JSON Codec Factory
 * Parses JSON strings into structured data and serializes back to JSON
 * @param schema - Zod schema to validate parsed JSON data
 */
export const json = <T extends z.ZodTypeAny>(schema: T) =>
	z.codec(z.string(), schema, {
		decode: (jsonString) => {
			try {
				return JSON.parse(jsonString);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(`Invalid JSON: ${message}`);
			}
		},
		encode: (value) => JSON.stringify(value)
	});

/**
 * Hex to Bytes Codec
 * Converts hexadecimal strings to Uint8Array byte arrays
 */
export const hexToBytes = z.codec(z.hex(), z.instanceof(Uint8Array), {
	decode: (hexString) => {
		const bytes = new Uint8Array(hexString.length / 2);
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = parseInt(hexString.substr(i * 2, 2), 16);
		}
		return bytes;
	},
	encode: (bytes) => {
		return Array.from(bytes)
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('');
	}
});

/**
 * URI Component Codec
 * Encodes and decodes URI components
 */
export const uriComponent = z.codec(z.string(), z.string(), {
	decode: (encodedString) => decodeURIComponent(encodedString),
	encode: (decodedString) => encodeURIComponent(decodedString)
});

/**
 * Boolean String Codec
 * Converts "true"/"false" strings to boolean
 */
export const stringToBoolean = z.codec(z.enum(['true', 'false']), z.boolean(), {
	decode: (str) => str === 'true',
	encode: (bool) => (bool ? 'true' : 'false')
});

/**
 * Nullable Codec
 * Converts null to undefined and vice versa
 */
export const nullToUndefined = z.codec(z.null(), z.undefined(), {
	decode: () => undefined,
	encode: () => null
});

// ---------------------------------------------------------------------------
// Composite Record IDs (DID-based ownership)
// ---------------------------------------------------------------------------

interface CompositeId {
	created_by: string;
	id: string;
}

/**
 * Create a RecordId with an embedded DID owner and optional ULID.
 * Format: `table:{ created_by: "did:syr:...", id: "<ulid>" }`
 */
export function createOwnedRecordId(table: string, did: string, localId?: string): RecordId {
	return new RecordId(table, { created_by: did, id: localId ?? ulid() });
}

/**
 * Reconstruct a composite RecordId from a full DID and a local ID.
 * Used in route handlers to rebuild the key from URL params.
 */
export function recordIdFromDidAndLocal(table: string, did: string, localId: string): RecordId {
	return new RecordId(table, { created_by: did, id: localId });
}

function assertCompositeRecordId(recordId: RecordId): void {
	const obj = recordId?.id;
	if (typeof obj !== 'object' || obj === null) {
		throw new Error(
			`Expected composite RecordId (object with created_by and id), got: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}`
		);
	}
	const o = obj as Record<string, unknown>;
	if (typeof o.created_by !== 'string' || typeof o.id !== 'string') {
		throw new Error(
			`Expected composite RecordId (created_by, id), got keys: ${Object.keys(o).join(', ')}`
		);
	}
}

/**
 * Extract the ULID portion from a composite RecordId.
 * @throws If recordId.id is not an object with created_by and id.
 */
export function extractLocalId(recordId: RecordId): string {
	assertCompositeRecordId(recordId);
	return (recordId.id as unknown as CompositeId).id;
}

/**
 * Extract the full DID string from a composite RecordId.
 * @throws If recordId.id is not an object with created_by and id.
 */
export function extractDid(recordId: RecordId): string {
	assertCompositeRecordId(recordId);
	return (recordId.id as unknown as CompositeId).created_by;
}

/**
 * Build a URL path segment from a composite RecordId.
 * Returns `${did}/${localId}`.
 */
export function buildResourceUrl(prefix: string, recordId: RecordId): string {
	return `${prefix}/${extractDid(recordId)}/${extractLocalId(recordId)}`;
}

/**
 * Get canonical post ID for URLs and API calls.
 * Uses did/local_id when present (API serialized), otherwise extracts from composite RecordId.
 */
export function getPostId(post: {
	id: RecordId | string;
	did?: string;
	local_id?: string;
}): string {
	if (post.did && post.local_id) return `${post.did}/${post.local_id}`;
	if (typeof post.id === 'string') return post.id;
	return `${extractDid(post.id)}/${extractLocalId(post.id)}`;
}

export { ulid } from 'ulid';
