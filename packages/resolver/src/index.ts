/**
 * @syr-is/resolver
 * DID resolver for did:syr.
 * Queries a SYR Registry to locate providers and fetches verified DID Documents.
 */

export { resolveDid, resolveProvider } from './resolve.js';
export { ResolverError } from './types.js';
export type { HostingRecord, ResolverOptions } from './types.js';
export type { DidDocument } from '@syr-is/did';
