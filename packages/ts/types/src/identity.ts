import { z } from 'zod';
import { BaseEntitySchema, RecordIdSchema, DidSyrSchema, TimestampSchema } from './common.js';

/**
 * Identity Schema
 * Represents a root identity record in SurrealDB.
 * Links a did:syr identifier and public key to a user account.
 * Never stores private keys.
 */
/** Aegis KDF params stored with the identity (Argon2id) */
export const AegisKdfParamsSchema = z.object({
	mem: z.number(),
	it: z.number(),
	par: z.number()
});

/** Aegis bundle: password-encrypted seed + KDF params (CIGP format) */
export const AegisBundleSchema = z.object({
	pub: z.string().min(1),
	salt: z.string().min(1),
	nonce: z.string().min(1),
	ct: z.string().min(1),
	tag: z.string().min(1),
	kdf: AegisKdfParamsSchema
});

export type AegisBundle = z.infer<typeof AegisBundleSchema>;

export const IdentitySchema = BaseEntitySchema.pick({
	id: true,
	created_at: true
}).extend({
	did: DidSyrSchema,
	public_key: z.string().min(1), // multibase-encoded Ed25519 public key
	user_id: RecordIdSchema,
	tenant_id: RecordIdSchema.optional(), // optional tenant scoping
	// Aegis (CIGP) encrypted seed - password-protected, server-stored
	aegis_salt: z.string().optional(),
	aegis_nonce: z.string().optional(),
	aegis_ct: z.string().optional(),
	aegis_tag: z.string().optional(),
	aegis_kdf_mem: z.number().optional(),
	aegis_kdf_it: z.number().optional(),
	aegis_kdf_par: z.number().optional()
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
 * canonical_delegation stores the exact string the client signed (RFC 8785 canonical form)
 * so re-verification uses the same bytes and verify() succeeds.
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
	signature: z.string().min(1), // multibase-encoded root signature
	canonical_delegation: z.string().min(1).optional() // exact signed string for re-verification
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
 * privateKey is optional; included for full migration bundles when server-managed.
 */
export const IdentityExportBundleSchema = z.object({
	did: DidSyrSchema,
	publicKey: z.string().min(1), // multibase-encoded root public key
	privateKey: z.string().min(1).optional(), // multibase-encoded root private key (full export only)
	didDocument: z.record(z.string(), z.unknown()),
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
 * Identity Delegate Request Schema
 * For the POST /api/identity/delegate endpoint (add device to existing identity).
 */
export const IdentityDelegateRequestSchema = z.object({
	did: DidSyrSchema,
	devicePublicKey: z.string().min(1),
	delegation: z.object({
		did: DidSyrSchema,
		delegate: z.string().min(1),
		scope: DelegationScopeSchema,
		createdAt: z.string().datetime(),
		expiresAt: z.string().datetime().optional(),
		signature: z.string().min(1)
	})
});

export type IdentityDelegateRequest = z.infer<typeof IdentityDelegateRequestSchema>;

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

/**
 * Identity Full Export Manifest Schema
 * Metadata about a full identity export zip.
 */
export const IdentityExportManifestSchema = z.object({
	version: z.literal(1),
	did: DidSyrSchema,
	exportedAt: z.string().datetime(),
	postCount: z.number().int().nonnegative(),
	assetCount: z.number().int().nonnegative()
});

export type IdentityExportManifest = z.infer<typeof IdentityExportManifestSchema>;

/** ULID format: 26 chars, Crockford Base32 (0-9, A-HJKMNP-TV-Z) */
const UlidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/i);

/** Path within zip's assets/ directory; disallow path traversal */
export const AssetZipPathSchema = z.string().regex(/^assets\/(?!.*\.\.)[^\0]+$/);

/**
 * Exported asset (inline in post or in assets.json).
 * Signature: JCS canonical of { did, local_id, filename, mime_type, size, zip_path, sha256? } signed with root key.
 */
export const ExportedAssetSchema = z.object({
	local_id: UlidSchema,
	filename: z.string(),
	mime_type: z.string(),
	size: z.number().int().nonnegative(),
	sha256: z.string().optional(),
	/** Path within the zip's assets/ directory */
	zip_path: AssetZipPathSchema,
	/** Multibase-encoded Ed25519 signature. Required for full backup; optional for data-only (legacy). */
	signature: z.string().min(1).optional()
});

export type ExportedAsset = z.infer<typeof ExportedAssetSchema>;

/**
 * Exported Post Schema
 * A post in the portable export format (no RecordId, uses string IDs).
 * `local_id` is the ULID portion of the composite record ID, preserved
 * so the same composite key can be recreated on import.
 * Signature: JCS canonical of post payload (excluding signature) signed with root key.
 */
export const ExportedPostSchema = z.object({
	local_id: UlidSchema,
	type: z.enum(['blog', 'media']),
	content_type: z.enum(['markdown', 'html']).optional(),
	title: z.string().optional(),
	description: z.string().max(280).optional(),
	content: z.string().optional(),
	media_urls: z.array(z.string().url()).optional(),
	display_mode: z.enum(['carousel', 'masonry', 'gallery']).optional(),
	visibility: z.enum(['public', 'unlisted', 'private']).default('public'),
	status: z.enum(['draft', 'completed']).default('draft'),
	created_at: z.string().datetime(),
	/** Multibase-encoded Ed25519 signature. Required for full backup; optional for data-only (legacy). */
	signature: z.string().min(1).optional(),
	assets: z.array(ExportedAssetSchema).optional()
});

export type ExportedPost = z.infer<typeof ExportedPostSchema>;

/**
 * Identity Import Request Schema
 * Validated during import to verify the zip contents are well-formed.
 */
export const IdentityImportRequestSchema = z.object({
	manifest: IdentityExportManifestSchema,
	identity: IdentityExportBundleSchema,
	posts: z.array(ExportedPostSchema)
});

export type IdentityImportRequest = z.infer<typeof IdentityImportRequestSchema>;
