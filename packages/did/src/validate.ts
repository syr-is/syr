import { parseDid } from "./parse.js";

/**
 * Check if a string is a valid did:syr identifier.
 *
 * Validates syntax, multibase decoding, multicodec prefix,
 * and Ed25519 public key length.
 *
 * @param did - The string to validate.
 * @returns True if the string is a valid did:syr identifier.
 */
export function isValidSyrDid(did: string): boolean {
  try {
    parseDid(did);
    return true;
  } catch {
    return false;
  }
}
