import { z } from 'zod';
import { BaseEntitySchema } from './common.js';

/**
 * Tenant Settings Schema
 * Configuration for a tenant, such as identity quotas and feature flags.
 */
export const TenantSettingsSchema = z.object({
	/** Maximum number of identities this tenant can have */
	max_identities: z.number().int().positive().default(100),
	/** Whether new identity creation is allowed */
	allow_identity_creation: z.boolean().default(true),
	/** Custom branding or metadata */
	metadata: z.record(z.string(), z.any()).optional()
});

export type TenantSettings = z.infer<typeof TenantSettingsSchema>;

/**
 * Tenant Schema
 * Represents an organization or group that owns a pool of identities.
 */
export const TenantSchema = BaseEntitySchema.extend({
	/** Human-readable tenant name */
	name: z.string().min(1).max(100),
	/** URL-safe slug for the tenant (unique) */
	slug: z
		.string()
		.min(1)
		.max(50)
		.regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
			message:
				'Slug must be lowercase alphanumeric with optional hyphens, not starting or ending with a hyphen'
		}),
	/** Tenant settings */
	settings: TenantSettingsSchema.default(() => ({
		max_identities: 100,
		allow_identity_creation: true
	}))
});

export type Tenant = z.infer<typeof TenantSchema>;

/**
 * Tenant Create Schema
 * For creating new tenants.
 */
export const TenantCreateSchema = z.object({
	name: z.string().min(1).max(100),
	slug: z
		.string()
		.min(1)
		.max(50)
		.regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
			message: 'Slug must be lowercase alphanumeric with optional hyphens'
		}),
	settings: TenantSettingsSchema.optional()
});

export type TenantCreate = z.infer<typeof TenantCreateSchema>;

/**
 * Tenant Update Schema
 * For updating tenant settings.
 */
export const TenantUpdateSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	settings: TenantSettingsSchema.partial().optional()
});

export type TenantUpdate = z.infer<typeof TenantUpdateSchema>;
