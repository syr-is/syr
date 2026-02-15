import { decodeMultibase, ED25519_MULTICODEC_PREFIX } from "@syr-is/crypto";
import type { ParsedDid } from "./types.js";

const DID_SYR_REGEX = /^did:syr:z[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * Parse a did:syr identifier into its components.
 *
 * @param did - The DID string to parse (e.g., "did:syr:z6Mkt9...")
 * @returns The parsed DID with method, id, and decoded public key.
 * @throws If the DID format is invalid, multibase decoding fails,
 *         or the embedded key is not a valid Ed25519 public key.
 */
export function parseDid(did: string): ParsedDid {
  if (!DID_SYR_REGEX.test(did)) {
    throw new Error(`Invalid did:syr format: '${did}'`);
  }

  const parts = did.split(":");
  if (parts.length !== 3 || parts[0] !== "did" || parts[1] !== "syr") {
    throw new Error(`Invalid did:syr format: '${did}'`);
  }

  const id = parts[2];

  // Decode multibase to get prefixed bytes
  const prefixedBytes = decodeMultibase(id);

  // Verify and strip multicodec prefix
  if (prefixedBytes.length < ED25519_MULTICODEC_PREFIX.length) {
    throw new Error(
      "Multibase-decoded bytes too short to contain multicodec prefix.",
    );
  }

  for (let i = 0; i < ED25519_MULTICODEC_PREFIX.length; i++) {
    if (prefixedBytes[i] !== ED25519_MULTICODEC_PREFIX[i]) {
      throw new Error(
        `Expected Ed25519 multicodec prefix (0xed01), got 0x${prefixedBytes[0].toString(16)}${prefixedBytes[1].toString(16)}.`,
      );
    }
  }

  const publicKey = prefixedBytes.slice(ED25519_MULTICODEC_PREFIX.length);

  if (publicKey.length !== 32) {
    throw new Error(
      `Expected 32-byte Ed25519 public key, got ${publicKey.length} bytes.`,
    );
  }

  return {
    method: "syr",
    id,
    publicKey,
  };
}
