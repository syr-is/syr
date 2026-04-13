import { z } from 'zod';
import { DidSyrSchema } from './common.js';
import { IdentityAuthScopeSchema } from './identity-auth.js';
import { DelegationScopeSchema } from './identity.js';

/**
 * Platform Delegation Types
 * Types for the platform delegation flow where third-party applications
 * receive delegated signing authority from a user's identity provider instance.
 */

// ── Registration Flow ──

/**
 * Platform Registration Request
 * Sent by a consumer application to an identity provider instance
 * to initiate platform delegation.
 */
export const PlatformRegistrationRequestSchema = z.object({
	/** DID of the user to delegate signing authority for */
	did: DidSyrSchema,
	/** Origin URL of the requesting platform */
	platform_origin: z.string().url(),
	/** Human-readable name of the requesting platform */
	platform_name: z.string().min(1).max(100),
	/** URL to redirect the user back to after consent */
	callback_url: z.string().url(),
	/** Scopes the platform is requesting */
	scopes: z.array(IdentityAuthScopeSchema).min(1),
	/** Opaque state value returned unchanged to the platform */
	state: z.string().optional()
});

export type PlatformRegistrationRequest = z.infer<typeof PlatformRegistrationRequestSchema>;

/**
 * Platform Registration Response
 * Returned by the identity provider instance after creating a pending registration.
 */
export const PlatformRegistrationResponseSchema = z.object({
	/** Unique challenge identifier */
	challenge_id: z.string(),
	/** URL where the user should be redirected for consent */
	consent_url: z.string().url(),
	/** Lifetime of the challenge in seconds */
	expires_in: z.number().int().positive()
});

export type PlatformRegistrationResponse = z.infer<typeof PlatformRegistrationResponseSchema>;

// ── Token Exchange ──

/**
 * Platform Token Request
 * Sent by the platform after the user completes consent.
 * Exchanges the authorization code for a platform access token.
 */
export const PlatformTokenRequestSchema = z.object({
	/** The authorization code received from the callback */
	code: z.string(),
	/** The original callback URL (must match) */
	callback_url: z.string().url(),
	/** The requesting origin (must match the original challenge) */
	platform_origin: z.string().url()
});

export type PlatformTokenRequest = z.infer<typeof PlatformTokenRequestSchema>;

/**
 * Platform Token Response
 * Returned to the platform after successful consent and token exchange.
 */
export const PlatformTokenResponseSchema = z.object({
	/** Bearer token for signing API access */
	access_token: z.string(),
	/** Token type — always "Bearer" */
	token_type: z.literal('Bearer'),
	/** Lifetime of the token in seconds */
	expires_in: z.number().int().positive(),
	/** The authenticated user's DID */
	did: DidSyrSchema,
	/** The delegate public key generated for this platform */
	delegate_public_key: z.string(),
	/** Granted scopes */
	scopes: z.array(IdentityAuthScopeSchema)
});

export type PlatformTokenResponse = z.infer<typeof PlatformTokenResponseSchema>;

// ── Signing-as-a-Service ──

/**
 * Platform Sign Request
 * Sent by the platform to request a signature on content.
 */
export const PlatformSignRequestSchema = z.object({
	/** The content payload to sign (will be JCS-canonicalized) */
	payload: z.record(z.string(), z.unknown()),
	/** Optional payload type hint (e.g., 'message@v1') */
	payload_type: z.string().optional()
});

export type PlatformSignRequest = z.infer<typeof PlatformSignRequestSchema>;

/**
 * Platform Sign Response
 * Returned after successfully signing content.
 */
export const PlatformSignResponseSchema = z.object({
	/** Multibase-encoded Ed25519 signature */
	signature: z.string(),
	/** The delegate public key that produced this signature */
	delegate_public_key: z.string(),
	/** The user's DID */
	did: DidSyrSchema,
	/** When the content was signed */
	signed_at: z.string().datetime()
});

export type PlatformSignResponse = z.infer<typeof PlatformSignResponseSchema>;

// ── Re-login Challenge ──

/**
 * Platform Challenge Request
 * Sent by the platform for re-authentication after initial registration.
 * The instance signs the challenge with the platform's delegate key.
 */
export const PlatformChallengeRequestSchema = z.object({
	/** The user's DID */
	did: DidSyrSchema,
	/** The requesting platform's origin */
	platform_origin: z.string().url(),
	/** A random challenge string to be signed */
	challenge: z.string().min(1)
});

export type PlatformChallengeRequest = z.infer<typeof PlatformChallengeRequestSchema>;

/**
 * Platform Challenge Response
 * Returned with the signed challenge for verification.
 */
export const PlatformChallengeResponseSchema = z.object({
	/** Multibase-encoded signature of the challenge */
	signature: z.string(),
	/** The delegate public key used to sign */
	delegate_public_key: z.string(),
	/** The user's DID */
	did: DidSyrSchema
});

export type PlatformChallengeResponse = z.infer<typeof PlatformChallengeResponseSchema>;

// ── Public Delegation Info ──

/**
 * Platform Delegation Info
 * Public information about a platform delegation, used for signature verification.
 */
export const PlatformDelegationInfoSchema = z.object({
	/** The delegate public key */
	delegate_public_key: z.string(),
	/** The platform origin this key was issued to */
	platform_origin: z.string().url(),
	/** Human-readable platform name */
	platform_name: z.string(),
	/** Delegation scope */
	scope: DelegationScopeSchema,
	/** When the delegation was created */
	created_at: z.string().datetime(),
	/** When the delegation was revoked (null if active) */
	revoked_at: z.string().datetime().optional(),
	/** When the delegation expires (null if no expiry) */
	expires_at: z.string().datetime().optional()
});

export type PlatformDelegationInfo = z.infer<typeof PlatformDelegationInfoSchema>;

// ── Delegation Statement (canonical payload signed by root key) ──

/**
 * The canonical delegation statement that the root key signs to authorize
 * a platform delegate keypair. This exact object is JCS-canonicalized and
 * signed; the signature is stored alongside the delegation record.
 */
export const PlatformDelegationStatementSchema = z.object({
	/** The identity DID being delegated from */
	did: DidSyrSchema,
	/** Multibase-encoded Ed25519 delegate public key */
	delegate: z.string().min(1),
	/** Always 'platform' for platform delegations */
	scope: z.literal('platform'),
	/** Platform origin URL */
	platform_origin: z.string().url(),
	/** Human-readable platform name */
	platform_name: z.string().min(1).max(100),
	/** ISO-8601 creation timestamp */
	createdAt: z.string().datetime()
});

export type PlatformDelegationStatement = z.infer<typeof PlatformDelegationStatementSchema>;
