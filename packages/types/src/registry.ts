import { z } from 'zod';

/**
 * DID format for did:syr identities
 */
const didSyr = z.string().startsWith('did:syr:').describe('DID must start with did:syr:');

/**
 * ISO-8601 timestamp string
 */
const isoTimestamp = z.iso.datetime().describe('ISO-8601 timestamp');

/**
 * Multibase-encoded Ed25519 signature
 */
const signature = z.string().describe('Multibase-encoded Ed25519 signature');

/**
 * Update hosting record payload
 * Signature is over canonical JSON of { did, provider, updatedAt }
 */
export const UpdateRecordSchema = z
	.object({
		did: didSyr.describe('DID to register or update'),
		provider: z.string().url().describe('Hosting provider URL'),
		updatedAt: isoTimestamp.describe('ISO-8601 timestamp'),
		signature: signature.describe(
			'Ed25519 signature over canonical { did, provider, updatedAt }'
		)
	})
	.meta({ id: 'UpdateRecord' });

export type UpdateRecord = z.infer<typeof UpdateRecordSchema>;

/**
 * Delete hosting record payload
 * Signature is over canonical JSON of { did, deletedAt }
 */
export const DeleteRecordSchema = z
	.object({
		did: didSyr.describe('DID to remove'),
		deletedAt: isoTimestamp.describe('ISO-8601 timestamp'),
		signature: signature.describe('Ed25519 signature over canonical { did, deletedAt }')
	})
	.meta({ id: 'DeleteRecord' });

export type DeleteRecord = z.infer<typeof DeleteRecordSchema>;
