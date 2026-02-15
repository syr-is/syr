/**
 * @syr-is/did
 * DID method implementation for did:syr.
 * Parsing, validation, and DID Document construction.
 */

export { parseDid } from './parse.js';
export { buildDidDocument } from './document.js';
export { isValidSyrDid } from './validate.js';

export type {
	ParsedDid,
	DidDocument,
	VerificationMethod,
	ServiceEndpoint
} from './types.js';
