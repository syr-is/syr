import { z } from 'zod';
import { BaseEntitySchema, RecordIdSchema, DidSyrSchema, TimestampSchema } from './common.js';

/**
 * Identity Schema
 * Represents a root identity record in SurrealDB.
 * Links a did:syr identifier and public key to a user account.
 * Never stores private keys.
 */
export const IdentitySchema = BaseEntitySchema.pick({
	id: true,
	created_at: true
}).extend({
	did: DidSyrSchema,
	public_key: z.string().min(1), // multibase-encoded Ed25519 public key
	user_id: RecordIdSchema
});

export type Identity = z.infer<typeof IdentitySchema>;

/**
 * Identity Create Schema
 * For creating new identity records (server-side).
 */
export const IdentityCreateSchema = z.object({
	did: DidSyrSchema,
	public_key: z.string().min(1),
	user_id: RecordIdSchema
});

export type IdentityCreate = z.infer<typeof IdentityCreateSchema>;

/**
 * Delegation Scope Schema
 * Defines the scope of authority for a delegated key.
 */
export const DelegationScopeSchema = z.enum(['device', 'session']);
export type DelegationScope = z.infer<typeof DelegationScopeSchema>;

/**
 * Delegated Key Schema
 * Represents a device key delegated by the root identity.
 * The signature field contains the root key's signature over the delegation statement.
 */
export const DelegatedKeySchema = BaseEntitySchema.pick({
	id: true,
	created_at: true
}).extend({
	did: DidSyrSchema,
	public_key: z.string().min(1), // multibase-encoded device public key
	scope: DelegationScopeSchema.default('device'),
	expires_at: TimestampSchema.optional(),
	revoked_at: TimestampSchema.optional(),
	signature: z.string().min(1) // multibase-encoded root signature
});

export type DelegatedKey = z.infer<typeof DelegatedKeySchema>;

/**
 * Delegated Key Create Schema
 * For creating new delegated key records (server-side).
 */
export const DelegatedKeyCreateSchema = z.object({
	did: DidSyrSchema,
	public_key: z.string().min(1),
	scope: DelegationScopeSchema.default('device'),
	expires_at: TimestampSchema.optional(),
	signature: z.string().min(1)
});

export type DelegatedKeyCreate = z.infer<typeof DelegatedKeyCreateSchema>;

/**
 * Delegation Statement Schema
 * The payload that is canonicalized and signed by the root key
 * to authorize a delegated key.
 */
export const DelegationStatementSchema = z.object({
	did: DidSyrSchema,
	delegate: z.string().min(1), // multibase-encoded delegate public key
	scope: DelegationScopeSchema,
	createdAt: z.string().datetime(),
	expiresAt: z.string().datetime().optional()
});

export type DelegationStatement = z.infer<typeof DelegationStatementSchema>;

/**
 * Rotation Statement Schema
 * The payload for root key rotation, signed by the current root key.
 */
export const RotationStatementSchema = z.object({
	did: DidSyrSchema,
	newRoot: z.string().min(1), // multibase-encoded new root public key
	rotatedAt: z.string().datetime(),
	signature: z.string().min(1) // multibase-encoded signature
});

export type RotationStatement = z.infer<typeof RotationStatementSchema>;

/**
 * Identity Export Bundle Schema
 * Portable identity data that can be exported and verified offline.
 * Never includes private keys.
 */
export const IdentityExportBundleSchema = z.object({
	did: DidSyrSchema,
	publicKey: z.string().min(1), // multibase-encoded root public key
	delegatedKeys: z.array(
		z.object({
			publicKey: z.string().min(1),
			scope: DelegationScopeSchema,
			createdAt: z.string().datetime(),
			expiresAt: z.string().datetime().optional(),
			revokedAt: z.string().datetime().optional(),
			signature: z.string().min(1)
		})
	),
	profile: z.object({
		displayName: z.string(),
		bio: z.string().optional(),
		avatarUrl: z.string().optional(),
		bannerUrl: z.string().optional()
	}),
	exportedAt: z.string().datetime()
});

export type IdentityExportBundle = z.infer<typeof IdentityExportBundleSchema>;

/**
 * Identity Init Request Schema
 * For the POST /api/identity/init endpoint.
 * Sent by the client after generating keys.
 */
export const IdentityInitRequestSchema = z.object({
	did: DidSyrSchema,
	publicKey: z.string().min(1), // multibase-encoded root public key
	devicePublicKey: z.string().min(1), // multibase-encoded device public key
	delegation: z.object({
		did: DidSyrSchema,
		delegate: z.string().min(1),
		scope: DelegationScopeSchema,
		createdAt: z.string().datetime(),
		expiresAt: z.string().datetime().optional(),
		signature: z.string().min(1)
	})
});

export type IdentityInitRequest = z.infer<typeof IdentityInitRequestSchema>;

/**
 * Signed Mutation Request Schema
 * Wraps a mutation payload with a cryptographic signature from a device key.
 */
export const SignedMutationSchema = z.object({
	payload: z.record(z.string(), z.any()),
	signature: z.string().min(1), // multibase-encoded device signature
	devicePublicKey: z.string().min(1) // multibase-encoded device public key
});

export type SignedMutation = z.infer<typeof SignedMutationSchema>;
