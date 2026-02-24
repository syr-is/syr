import { z } from 'zod';
import { DidSyrSchema } from './common.js';

/**
 * Identity-Based Auth Scopes
 * Defines what a third party can access when a user authenticates via their SYR instance.
 */
export const IdentityAuthScopeSchema = z.enum([
	'identity:read', // Read the user's DID and public profile
	'identity:verify', // Verify credentials issued to the user
	'profile:read', // Read display name, bio, avatar
	'posts:read', // Read the user's posts
	'posts:write' // Create/edit posts on behalf of the user
]);

export type IdentityAuthScope = z.infer<typeof IdentityAuthScopeSchema>;

/**
 * Identity Auth Challenge Request
 * Sent by a third-party platform to a user's SYR instance
 * to initiate an identity-based login.
 */
export const IdentityAuthChallengeRequestSchema = z.object({
	/** DID of the user being authenticated */
	did: DidSyrSchema,
	/** Origin URL of the requesting third party */
	origin: z.url(),
	/** Scopes the third party is requesting */
	scopes: z.array(IdentityAuthScopeSchema).min(1),
	/** Opaque state value returned unchanged to the third party */
	state: z.string().optional(),
	/** URL to redirect the user back to after authentication */
	callback_url: z.url()
});

export type IdentityAuthChallengeRequest = z.infer<typeof IdentityAuthChallengeRequestSchema>;

/**
 * Identity Auth Challenge Response
 * Returned by the SYR instance to the third-party platform.
 * Contains a challenge token the user must present during consent.
 */
export const IdentityAuthChallengeResponseSchema = z.object({
	/** Unique challenge identifier */
	challenge_id: z.string(),
	/** URL where the user should be redirected for consent */
	consent_url: z.url(),
	/** Lifetime of the challenge in seconds */
	expires_in: z.number().int().positive()
});

export type IdentityAuthChallengeResponse = z.infer<typeof IdentityAuthChallengeResponseSchema>;

/**
 * Identity Auth Token Request
 * Sent by the third party after the user completes consent.
 * Exchanges the authorization code for an access token.
 */
export const IdentityAuthTokenRequestSchema = z.object({
	/** The authorization code received from the callback */
	code: z.string(),
	/** The original callback URL (must match) */
	callback_url: z.url(),
	/** The requesting origin (must match the original challenge) */
	origin: z.url()
});

export type IdentityAuthTokenRequest = z.infer<typeof IdentityAuthTokenRequestSchema>;

/**
 * Identity Auth Token Response
 * Returned to the third party after successful authentication.
 */
export const IdentityAuthTokenResponseSchema = z.object({
	/** Bearer token for API access */
	access_token: z.string(),
	/** Token type — always "Bearer" */
	token_type: z.literal('Bearer'),
	/** Lifetime of the token in seconds */
	expires_in: z.number().int().positive(),
	/** The authenticated user's DID */
	did: DidSyrSchema,
	/** Granted scopes (may be a subset of requested) */
	scopes: z.array(IdentityAuthScopeSchema)
});

export type IdentityAuthTokenResponse = z.infer<typeof IdentityAuthTokenResponseSchema>;

/**
 * Identity Auth User Info Response
 * Returned by the SYR instance when a third party requests user info
 * with a valid access token.
 */
export const IdentityAuthUserInfoSchema = z.object({
	/** The user's DID */
	did: DidSyrSchema,
	/** The user's username on this instance */
	username: z.string(),
	/** Display name */
	display_name: z.string().optional(),
	/** Bio */
	bio: z.string().optional(),
	/** Avatar URL */
	avatar_url: z.url().optional(),
	/** Banner URL */
	banner_url: z.url().optional(),
	/** Public key (multibase-encoded) */
	public_key: z.string().optional()
});

export type IdentityAuthUserInfo = z.infer<typeof IdentityAuthUserInfoSchema>;

/**
 * Identity Auth Error Response
 */
export const IdentityAuthErrorResponseSchema = z.object({
	error: z.enum([
		'invalid_request',
		'unknown_did',
		'challenge_expired',
		'consent_denied',
		'invalid_code',
		'invalid_origin',
		'invalid_scope',
		'server_error'
	]),
	error_description: z.string().optional()
});

export type IdentityAuthErrorResponse = z.infer<typeof IdentityAuthErrorResponseSchema>;

/**
 * Identity Resolution Request
 * Used by third parties to discover a user's SYR instance from their DID.
 */
export const IdentityResolutionRequestSchema = z.object({
	/** The DID to resolve */
	did: DidSyrSchema
});

export type IdentityResolutionRequest = z.infer<typeof IdentityResolutionRequestSchema>;

/**
 * Identity Resolution Response
 * Returns the instance URL and public info for a DID.
 */
export const IdentityResolutionResponseSchema = z.object({
	/** The resolved DID */
	did: DidSyrSchema,
	/** The SYR instance URL where this identity is hosted */
	instance_url: z.url(),
	/** The user's public key (multibase-encoded) */
	public_key: z.string(),
	/** The user's username on the instance */
	username: z.string()
});

export type IdentityResolutionResponse = z.infer<typeof IdentityResolutionResponseSchema>;
