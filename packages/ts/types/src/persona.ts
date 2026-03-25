/**
 * Persona Schema
 * Local identity stored on disk for Syner app.
 * Aligns with IdentityExportBundle.profile shape.
 */
import { z } from 'zod';
import { IdentityHostUrlSchema } from './common.js';

export const PersonaProfileSchema = z.object({
	displayName: z.string(),
	bio: z.string().optional(),
	avatarUrl: z.string().optional(),
	bannerUrl: z.string().optional(),
	identityHostUrl: IdentityHostUrlSchema.optional()
});

export type PersonaProfile = z.infer<typeof PersonaProfileSchema>;

export const PersonaSchema = z.object({
	id: z.string(),
	did: z.string(),
	publicKey: z.string(), // base64 or multibase
	displayName: z.string(),
	bio: z.string().optional(),
	avatarUrl: z.string().optional(),
	bannerUrl: z.string().optional(),
	identityHostUrl: IdentityHostUrlSchema.optional(),
	createdAt: z.string()
});

export type Persona = z.infer<typeof PersonaSchema>;
