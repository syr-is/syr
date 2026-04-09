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

// Profile stories (public reel)
export * from './stories.js';

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

// Signed mutations (client-signed profile/post)
export * from './signed-mutations.js';

// Persona types (Syner local identities)
export * from './persona.js';

// Identity manifest (per-identity discovery at /.well-known/syr/{did})
export * from './identity-manifest.js';

// Emoji & sticker types
export * from './emojis.js';

// GIF types
export * from './gifs.js';

// Comment types
export * from './comments.js';

// Reaction types
export * from './reactions.js';
