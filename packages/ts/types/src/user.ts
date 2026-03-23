import { z } from 'zod';
import {
	BaseEntitySchema,
	MetadataSchema,
	TimestampSchema,
	RecordIdSchema,
	DidSyrSchema
} from './common.js';
import { SignedMutationEnvelopeSchema } from './signed-mutations.js';

/**
 * User Role Schema
 * For instance-level access control
 */
export const UserRoleSchema = z.enum(['ADMIN', 'USER']);
export type UserRole = z.infer<typeof UserRoleSchema>;

/**
 * User Schema
 * Represents a user account in the SYR system
 * Designed for sovereignty - username and DID only, no email
 */
export const UserSchema = BaseEntitySchema.extend({
	username: z
		.string()
		.min(3, 'Username must be at least 3 characters')
		.max(30, 'Username must be at most 30 characters')
		.regex(
			/^[a-zA-Z0-9_-]+$/,
			'Username can only contain letters, numbers, underscores, and hyphens'
		),
	password_hash: z.string(),
	did: DidSyrSchema.optional(), // Optional for backward compat; set during identity creation
	role: UserRoleSchema.default('USER'), // Instance-level role for access control
	username_last_updated: TimestampSchema.optional(), // When username was last changed; null = never changed, allow first update
	signing_warn_before_each_action: z.boolean().optional(),
	signing_require_explicit_sign_button: z.boolean().optional(),
	/** When true, hide posts without a content signature in your own posts list (client may filter). */
	feed_hide_unsigned_posts: z.boolean().optional(),
	/** When true, treat author publication registry bases as implicit allow prefixes in post content trust. */
	content_trust_auto_author_provider: z.boolean().optional(),
	/** Allow data:/blob: in sanitized post HTML (off by default). */
	content_trust_allow_data_urls: z.boolean().optional(),
	/** Max decoded post payload bytes the user allows the browser to load (feeds, lists); null = app default. */
	content_max_post_bytes: z.number().int().positive().optional()
});

export type User = z.infer<typeof UserSchema>;

/**
 * Profile Schema
 * User profile information
 */
export const ProfileSchema = BaseEntitySchema.extend({
	user_id: RecordIdSchema,
	display_name: z.string().min(1).max(100),
	bio: z.string().max(500).optional(),
	avatar_url: z.url().optional(),
	banner_url: z.url().optional(),
	metadata: MetadataSchema.optional(),
	content_signature: z.string().optional(),
	signed_payload_json: z.string().optional(),
	signing_device_public_key: z.string().optional()
});

export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileCreateSchema = ProfileSchema.pick({
	user_id: true,
	display_name: true
});

export type ProfileCreate = z.infer<typeof ProfileCreateSchema>;

/**
 * User Registration Input Schema (for API)
 * For validating user registration requests on the backend
 * True digital sovereignty - no email required
 */
export const UserRegistrationInputSchema = z.object({
	username: UserSchema.shape.username,
	password: z
		.string()
		.min(8, 'Password must be at least 8 characters')
		.regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
		.regex(/[a-z]/, 'Password must contain at least one lowercase letter')
		.regex(/[0-9]/, 'Password must contain at least one number'),
	display_name: z.string().min(1).max(100)
});

export type UserRegistrationInput = z.infer<typeof UserRegistrationInputSchema>;

/**
 * User Registration Schema (for forms with password confirmation)
 * For validating user registration forms with password confirmation
 */
export const UserRegistrationSchema = UserRegistrationInputSchema.extend({
	confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
	message: 'Passwords do not match',
	path: ['confirmPassword']
});

export type UserRegistration = z.infer<typeof UserRegistrationSchema>;

/**
 * User Login Schema
 * For validating user login requests
 */
export const UserLoginSchema = z.object({
	username: z.string().min(1),
	password: z.string().min(1)
});

export type UserLogin = z.infer<typeof UserLoginSchema>;

/**
 * Profile Update Schema
 * For validating profile update requests
 * Uses zod traversal to remove defaults and make all fields optional
 */
export const ProfileUpdateSchema = ProfileSchema.pick({
	display_name: true,
	bio: true,
	avatar_url: true,
	banner_url: true,
	metadata: true
}).partial();

export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

/** HTTP body for PATCH /api/user/profile (profile fields + optional signed envelope) */
export const ProfilePatchRequestSchema = ProfileUpdateSchema.extend({
	signed_mutation: SignedMutationEnvelopeSchema.optional()
});

export type ProfilePatchRequest = z.infer<typeof ProfilePatchRequestSchema>;

/** Fields the server may merge after verified signing (not sent as profile form fields by clients) */
export const ProfileSignatureFieldsSchema = z.object({
	content_signature: z.string(),
	signed_payload_json: z.string(),
	signing_device_public_key: z.string()
});

export type ProfileSignatureFields = z.infer<typeof ProfileSignatureFieldsSchema>;

export const ProfileRepositoryMergeSchema = ProfileUpdateSchema.and(
	z.object({
		content_signature: z.string().optional(),
		signed_payload_json: z.string().optional(),
		signing_device_public_key: z.string().optional()
	})
);

export type ProfileRepositoryMerge = z.infer<typeof ProfileRepositoryMergeSchema>;

/**
 * Session Schema
 * Represents an authenticated session
 */
export const SessionSchema = BaseEntitySchema.pick({
	id: true,
	created_at: true
}).extend({
	user_id: RecordIdSchema,
	token: z.string(),
	expires_at: TimestampSchema,
	ip: z.string().optional(),
	user_agent: z.string().optional(),
	last_active: TimestampSchema.optional()
});

export type Session = z.infer<typeof SessionSchema>;

/**
 * Authenticated User
 * Combined user and profile information for authenticated contexts
 */
export const AuthenticatedUserSchema = UserSchema.pick({
	id: true,
	username: true,
	did: true,
	role: true
}).extend({
	display_name: ProfileSchema.shape.display_name,
	avatar_url: ProfileSchema.shape.avatar_url
});

export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>;
