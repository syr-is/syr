import { z } from "zod";
import { BaseEntitySchema } from "./common.js";

/**
 * OAuth Grant Types
 */
export const OAuthGrantTypeSchema = z.enum([
  "authorization_code",
  "refresh_token",
  "client_credentials",
]);

export type OAuthGrantType = z.infer<typeof OAuthGrantTypeSchema>;

/**
 * OAuth Response Types
 */
export const OAuthResponseTypeSchema = z.enum(["code", "token"]);
export type OAuthResponseType = z.infer<typeof OAuthResponseTypeSchema>;

/**
 * OAuth Scopes
 */
export const OAuthScopeSchema = z.enum([
  "openid",
  "profile",
  "email",
  "read:activities",
  "write:activities",
  "read:credentials",
  "write:credentials",
  "read:proofs",
  "write:proofs",
]);

export type OAuthScope = z.infer<typeof OAuthScopeSchema>;

/**
 * OAuth Client Schema
 * Registered OAuth 2.0 clients
 */
export const OAuthClientSchema = BaseEntitySchema.extend({
  client_id: z.string(),
  client_secret: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  redirect_uris: z.array(z.url()),
  allowed_scopes: z.array(OAuthScopeSchema),
  owner_user_id: z.uuid(),
});

export type OAuthClient = z.infer<typeof OAuthClientSchema>;

/**
 * OAuth Client Registration Request Schema
 */
export const OAuthClientRegistrationSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  redirect_uris: z.array(z.url()).min(1),
  scopes: z.array(OAuthScopeSchema).min(1),
});

export type OAuthClientRegistration = z.infer<
  typeof OAuthClientRegistrationSchema
>;

/**
 * OAuth Authorization Code Schema
 */
export const OAuthAuthorizationCodeSchema = BaseEntitySchema.pick({
  id: true,
  created_at: true,
}).extend({
  code: z.string(),
  client_id: z.string(),
  user_id: z.uuid(),
  redirect_uri: z.url(),
  scopes: z.array(OAuthScopeSchema),
  expires_at: z.iso.datetime(),
  used: z.boolean().default(false),
});

export type OAuthAuthorizationCode = z.infer<
  typeof OAuthAuthorizationCodeSchema
>;

/**
 * OAuth Access Token Schema
 */
export const OAuthAccessTokenSchema = BaseEntitySchema.pick({
  id: true,
  created_at: true,
}).extend({
  token: z.string(),
  client_id: z.string(),
  user_id: z.uuid(),
  scopes: z.array(OAuthScopeSchema),
  expires_at: z.iso.datetime(),
  revoked: z.boolean().default(false),
});

export type OAuthAccessToken = z.infer<typeof OAuthAccessTokenSchema>;

/**
 * OAuth Refresh Token Schema
 */
export const OAuthRefreshTokenSchema = BaseEntitySchema.pick({
  id: true,
  created_at: true,
}).extend({
  token: z.string(),
  access_token_id: z.uuid(),
  client_id: z.string(),
  user_id: z.uuid(),
  scopes: z.array(OAuthScopeSchema),
  expires_at: z.iso.datetime(),
  revoked: z.boolean().default(false),
});

export type OAuthRefreshToken = z.infer<typeof OAuthRefreshTokenSchema>;

/**
 * OAuth Authorization Request Schema
 */
export const OAuthAuthorizationRequestSchema = z.object({
  response_type: OAuthResponseTypeSchema,
  client_id: z.string(),
  redirect_uri: z.url(),
  scope: z.string(),
  state: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.enum(["plain", "S256"]).optional(),
});

export type OAuthAuthorizationRequest = z.infer<
  typeof OAuthAuthorizationRequestSchema
>;

/**
 * OAuth Authorization Response Schema
 */
export const OAuthAuthorizationResponseSchema = z.object({
  code: z.string(),
  state: z.string().optional(),
});

export type OAuthAuthorizationResponse = z.infer<
  typeof OAuthAuthorizationResponseSchema
>;

/**
 * OAuth Token Request Schema
 */
export const OAuthTokenRequestSchema = z.object({
  grant_type: OAuthGrantTypeSchema,
  code: z.string().optional(),
  redirect_uri: z.url().optional(),
  client_id: z.string(),
  client_secret: z.string(),
  refresh_token: z.string().optional(),
  code_verifier: z.string().optional(),
});

export type OAuthTokenRequest = z.infer<typeof OAuthTokenRequestSchema>;

/**
 * OAuth Token Response Schema
 */
export const OAuthTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().optional(),
  scope: z.string(),
});

export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;

/**
 * OAuth Token Revocation Request Schema
 */
export const OAuthTokenRevocationRequestSchema = z.object({
  token: z.string(),
  token_type_hint: z.enum(["access_token", "refresh_token"]).optional(),
});

export type OAuthTokenRevocationRequest = z.infer<
  typeof OAuthTokenRevocationRequestSchema
>;

/**
 * OAuth UserInfo Response Schema
 * OpenID Connect UserInfo endpoint response
 */
export const OAuthUserInfoResponseSchema = z.object({
  sub: z.string(),
  name: z.string().optional(),
  preferred_username: z.string().optional(),
  email: z.email().optional(),
  email_verified: z.boolean().optional(),
  picture: z.url().optional(),
  profile: z.url().optional(),
  updated_at: z.number().optional(),
});

export type OAuthUserInfoResponse = z.infer<typeof OAuthUserInfoResponseSchema>;

/**
 * OAuth Error Response Schema
 */
export const OAuthErrorResponseSchema = z.object({
  error: z.enum([
    "invalid_request",
    "invalid_client",
    "invalid_grant",
    "unauthorized_client",
    "unsupported_grant_type",
    "invalid_scope",
    "access_denied",
    "server_error",
    "temporarily_unavailable",
  ]),
  error_description: z.string().optional(),
  error_uri: z.url().optional(),
});

export type OAuthErrorResponse = z.infer<typeof OAuthErrorResponseSchema>;
