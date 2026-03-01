/**
 * @syr-is/types
 * Shared type definitions and Zod schemas for the SYR platform
 */

// Common base schemas
export * from './common.js';

// Codecs for data transformation
export * from './codecs.js';

// User types
export * from './user.js';

// ActivityPub types
export * from './activitypub.js';

// Identity-Based Auth types (replaces OAuth)
export * from './identity-auth.js';

// Independent Login (challenge-sign-verify)
export * from './independent-login.js';

// Event types
export * from './events.js';

// API types
export * from './api.js';

// Upload types
export * from './uploads.js';

// Post types
export * from './posts.js';

// Folder types
export * from './folders.js';

// KV (Key-Value) types
export * from './kv.js';

// Identity types
export * from './identity.js';

// Tenant types
export * from './tenant.js';

// Registry (DID hosting record) types
export * from './registry.js';

// Persona types (Syner local identities)
export * from './persona.js';
