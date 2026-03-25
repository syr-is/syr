import { z } from 'zod';
import { DidSyrSchema, IdentityHostUrlSchema } from './common.js';

/**
 * Independent Login Challenge Request
 * Sent by the SYR web app to initiate challenge-sign-verify login.
 */
export const IndependentLoginChallengeRequestSchema = z.object({
	/** Origin URL of the requesting page (for validation) */
	origin: z.string().url()
});

export type IndependentLoginChallengeRequest = z.infer<
	typeof IndependentLoginChallengeRequestSchema
>;

/**
 * Challenge message payload (JCS canonical JSON, signed by user).
 */
export const IndependentLoginChallengeMessageSchema = z.object({
	/** Domain of the SYR instance */
	domain: z.string(),
	/** Unique nonce (UUID) */
	nonce: z.string().uuid(),
	/** Action type — always "login" */
	action: z.literal('login'),
	/** ISO-8601 when challenge was issued */
	issued_at: z.string(),
	/** ISO-8601 when challenge expires */
	expires_at: z.string()
});

export type IndependentLoginChallengeMessage = z.infer<
	typeof IndependentLoginChallengeMessageSchema
>;

/**
 * Independent Login Challenge Response
 * Returned by the server after creating a challenge.
 */
export const IndependentLoginChallengeResponseSchema = z.object({
	/** Unique challenge identifier */
	challenge_id: z.string().uuid(),
	/** The message to sign (JCS canonical JSON string) */
	message: z.string(),
	/** Full deep link URL for Syner: syr://login?challenge=...&instance=...&callback=... */
	deeplink_url: z.string(),
	/** Lifetime of the challenge in seconds */
	expires_in: z.number().int().positive()
});

export type IndependentLoginChallengeResponse = z.infer<
	typeof IndependentLoginChallengeResponseSchema
>;

/**
 * Independent Login Verify Request
 * Sent by Syner after the user signs the challenge.
 */
export const IndependentLoginVerifyRequestSchema = z.object({
	/** The challenge ID from the challenge response */
	challenge_id: z.string().uuid(),
	/** The user's DID (proves key control via signature) */
	did: DidSyrSchema,
	/** Multibase-encoded Ed25519 signature of the message */
	signature: z.string(),
	/** Optional invite code for future invite-only mode */
	invite_code: z.string().optional(),
	/** Optional profile data from Syner persona */
	profile: z
		.object({
			display_name: z.string().min(1).max(100).optional(),
			bio: z.string().max(500).optional(),
			identity_host_url: IdentityHostUrlSchema.optional()
		})
		.optional()
});

export type IndependentLoginVerifyRequest = z.infer<typeof IndependentLoginVerifyRequestSchema>;

/**
 * Independent Login Verify Response
 * Returned after successful signature verification.
 */
export const IndependentLoginVerifyResponseSchema = z.object({
	/** Whether verification succeeded */
	success: z.literal(true),
	/** One-time token to exchange for session via callback URL */
	callback_token: z.string(),
	/** Short-lived token for profile sync (new users or incomplete profile) */
	sync_token: z.string().optional()
});

export type IndependentLoginVerifyResponse = z.infer<typeof IndependentLoginVerifyResponseSchema>;

/**
 * Independent Login Error Response
 */
export const IndependentLoginErrorResponseSchema = z.object({
	error: z.enum([
		'invalid_request',
		'challenge_expired',
		'invalid_signature',
		'invalid_origin',
		'invite_required',
		'invalid_invite',
		'server_error'
	]),
	error_description: z.string().optional()
});

export type IndependentLoginErrorResponse = z.infer<typeof IndependentLoginErrorResponseSchema>;

/**
 * Profile Sync signed payload (JCS canonical JSON, signed by persona private key).
 * Proves control of the DID when Syner syncs profile to SYR.
 */
export const ProfileSyncSignedPayloadSchema = z.object({
	action: z.literal('profile-sync'),
	did: DidSyrSchema,
	/** ISO-8601 when payload was created (replay protection: reject if > 5 min old) */
	issued_at: z.string(),
	display_name: z.string().max(100).optional(),
	bio: z.string().max(500).optional(),
	identity_host_url: IdentityHostUrlSchema.optional()
});

export type ProfileSyncSignedPayload = z.infer<typeof ProfileSyncSignedPayloadSchema>;
