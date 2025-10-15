import { z } from "zod";
import { zx } from "@traversable/zod";
import {
  BaseEntitySchema,
  DIDSchema,
  MetadataSchema,
  TimestampSchema,
  RecordIdSchema,
} from "./common.js";

/**
 * User Role Schema
 * For instance-level access control
 */
export const UserRoleSchema = z.enum(["ADMIN", "USER"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

/**
 * User Schema
 * Represents a user account in the SYR system
 * Designed for sovereignty - username and DID only, no email
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
  password_hash: z.string(),
  did: DIDSchema.optional(), // did:web for true sovereignty (DNS-based, no blockchain)
  role: UserRoleSchema.default("USER"), // Instance-level role for access control
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
});

export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileCreateSchema = ProfileSchema.pick({
  user_id: true,
  display_name: true,
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
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  display_name: z.string().min(1).max(100),
});

export type UserRegistrationInput = z.infer<typeof UserRegistrationInputSchema>;

/**
 * User Registration Schema (for forms with password confirmation)
 * For validating user registration forms with password confirmation
 */
export const UserRegistrationSchema = UserRegistrationInputSchema.extend({
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
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
 * Uses zod traversal to remove defaults and make all fields optional
 */
export const ProfileUpdateSchema = zx.deepNoDefaults(
  ProfileSchema.pick({
    display_name: true,
    bio: true,
    avatar_url: true,
    banner_url: true,
    metadata: true,
  })
);

export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

/**
 * Session Schema
 * Represents an authenticated session
 */
export const SessionSchema = BaseEntitySchema.pick({
  id: true,
  created_at: true,
}).extend({
  user_id: RecordIdSchema,
  token: z.string(),
  expires_at: TimestampSchema,
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
  role: true,
}).extend({
  display_name: ProfileSchema.shape.display_name,
  avatar_url: ProfileSchema.shape.avatar_url,
});

export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>;
