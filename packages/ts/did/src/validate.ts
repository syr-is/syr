import * as wasm from "@syr-is/crypto/wasm";

/**
 * Check if a string is a valid did:syr identifier.
 *
 * Validates syntax, multibase decoding, multicodec prefix,
 * and Ed25519 public key length.
 *
 * @param did - The string to validate.
 * @returns True if the string is a valid did:syr identifier.
 *
 * Note: Call initCryptoWasm() from @syr-is/crypto before using this function.
 */
export function isValidSyrDid(did: string): boolean {
  return wasm.is_valid_syr_did_wasm(did);
}
