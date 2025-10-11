import { z } from "zod";
import { BaseEntitySchema, DIDSchema, MetadataSchema } from "./common.js";

/**
 * User Schema
 * Represents a user account in the SYR system
 * Designed for sovereignty - no email required
 */
export const UserSchema = BaseEntitySchema.extend({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Username can only contain letters, numbers, underscores, and hyphens"
    ),
  email: z.email("Invalid email address").optional(),
  password_hash: z.string(),
  did: DIDSchema.optional(), // did:web for true sovereignty (DNS-based, no blockchain)
});

export type User = z.infer<typeof UserSchema>;

/**
 * Profile Schema
 * User profile information
 */
export const ProfileSchema = BaseEntitySchema.extend({
  user_id: z.uuid(),
  display_name: z.string().min(1).max(100),
  bio: z.string().max(500).optional(),
  avatar_url: z.url().optional(),
  banner_url: z.url().optional(),
  metadata: MetadataSchema.optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;

/**
 * User Registration Schema
 * For validating user registration requests
 * Email is optional for true digital sovereignty
 */
export const UserRegistrationSchema = z.object({
  username: UserSchema.shape.username,
  email: z.email("Invalid email address").optional(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  display_name: z.string().min(1).max(100),
});

export type UserRegistration = z.infer<typeof UserRegistrationSchema>;

/**
 * User Login Schema
 * For validating user login requests
 */
export const UserLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type UserLogin = z.infer<typeof UserLoginSchema>;

/**
 * Profile Update Schema
 * For validating profile update requests
 */
export const ProfileUpdateSchema = ProfileSchema.pick({
  display_name: true,
  bio: true,
  avatar_url: true,
  banner_url: true,
  metadata: true,
}).partial();

export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

/**
 * Session Schema
 * Represents an authenticated session
 */
export const SessionSchema = BaseEntitySchema.pick({
  id: true,
  created_at: true,
}).extend({
  user_id: z.uuid(),
  token: z.string(),
  expires_at: z.iso.datetime(),
});

export type Session = z.infer<typeof SessionSchema>;

/**
 * Authenticated User
 * Combined user and profile information for authenticated contexts
 */
export const AuthenticatedUserSchema = UserSchema.pick({
  id: true,
  username: true,
  email: true,
  did: true,
}).extend({
  display_name: ProfileSchema.shape.display_name,
  avatar_url: ProfileSchema.shape.avatar_url,
});

export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>;
