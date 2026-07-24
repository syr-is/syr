import { z } from 'zod';
import { RotationStatementSchema } from './identity.js';

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
 * Optional root-key rotation chain (ordered, seq 1..n from the genesis key).
 * When present, registries verify the chain from the DID-derived genesis key
 * to the current root and verify the record signature under the CURRENT key.
 * Registries persist the committed chain per DID and require an incoming chain
 * to exactly EXTEND it (every committed statement reproduced as a prefix);
 * shorter chains, same-length divergence, and forks below the committed tip are
 * all rejected as rollback/fork attacks (rollback + prefix-pinning protection).
 */
const rotationChain = z
	.array(RotationStatementSchema)
	.optional()
	.describe('Root-key rotation chain from genesis to current key');

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
			'Ed25519 signature over canonical { did, provider, updatedAt } by the current root key'
		),
		rotation_chain: rotationChain
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
		signature: signature.describe(
			'Ed25519 signature over canonical { did, deletedAt } by the current root key'
		),
		rotation_chain: rotationChain
	})
	.meta({ id: 'DeleteRecord' });

export type DeleteRecord = z.infer<typeof DeleteRecordSchema>;

/**
 * Opt-in public directory row (registry search).
 * Signature is over canonical JSON of { did, provider, username, displayName, listed, updatedAt }.
 */
export const DirectoryUpsertSchema = z
	.object({
		did: didSyr,
		provider: z.string().url(),
		username: z.string().min(1).max(64),
		displayName: z.string().min(1).max(100),
		listed: z.boolean(),
		updatedAt: isoTimestamp,
		signature,
		rotation_chain: rotationChain
	})
	.meta({ id: 'DirectoryUpsert' });

export type DirectoryUpsert = z.infer<typeof DirectoryUpsertSchema>;
