import { base58 } from "@scure/base";

/**
 * Multicodec prefix for Ed25519 public keys.
 * varint 0xed = [0xed, 0x01]
 */
export const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);

/**
 * Encode bytes as a multibase base58btc string.
 * Prefix 'z' indicates base58btc encoding per the multibase spec.
 * @param bytes - The bytes to encode.
 * @returns A multibase string starting with 'z'.
 */
export function encodeMultibase(bytes: Uint8Array): string {
  return "z" + base58.encode(bytes);
}

/**
 * Decode a multibase base58btc string to bytes.
 * @param encoded - A multibase string starting with 'z'.
 * @returns The decoded bytes.
 * @throws If the string is empty, does not start with 'z', or decoding fails.
 */
export function decodeMultibase(encoded: string): Uint8Array {
  if (encoded.length === 0) {
    throw new Error("Empty input: missing multibase prefix.");
  }
  if (!encoded.startsWith("z")) {
    throw new Error(
      `Unsupported multibase prefix: '${encoded[0]}'. Expected 'z' (base58btc).`,
    );
  }
  return base58.decode(encoded.slice(1));
}

/**
 * Decode a multibase-encoded Ed25519 public key to 32 raw bytes.
 * Strips the multicodec prefix (0xed 0x01) if present.
 *
 * @param encoded - Multibase string (e.g. from a DID or request body).
 * @returns 32-byte Ed25519 public key.
 * @throws If decoding fails or the result is not 32 bytes.
 */
export function decodePublicKey(encoded: string): Uint8Array {
  const bytes = decodeMultibase(encoded);
  let raw: Uint8Array = bytes;
  if (
    bytes.length === 34 &&
    bytes[0] === ED25519_MULTICODEC_PREFIX[0] &&
    bytes[1] === ED25519_MULTICODEC_PREFIX[1]
  ) {
    raw = bytes.slice(2);
  }
  if (raw.length !== 32) {
    throw new Error(
      `Invalid public key length: expected 32 bytes (Ed25519), got ${raw.length} after decoding.`,
    );
  }
  return raw;
}

/**
 * Decode a multibase-encoded Ed25519 private key to 32 raw bytes.
 * Strips the multicodec prefix (0xed 0x01) if present.
 *
 * @param encoded - Multibase string (e.g. from identity storage).
 * @returns 32-byte Ed25519 private key.
 * @throws If decoding fails or the result is not 32 bytes.
 */
export function decodePrivateKey(encoded: string): Uint8Array {
  const bytes = decodeMultibase(encoded);
  let raw: Uint8Array = bytes;
  if (
    bytes.length === 34 &&
    bytes[0] === ED25519_MULTICODEC_PREFIX[0] &&
    bytes[1] === ED25519_MULTICODEC_PREFIX[1]
  ) {
    raw = bytes.slice(2);
  }
  if (raw.length !== 32) {
    throw new Error(
      `Invalid private key length: expected 32 bytes (Ed25519), got ${raw.length} after decoding.`,
    );
  }
  return raw;
}

/**
 * Derive a did:syr identifier from an Ed25519 public key.
 *
 * Process:
 * 1. Prepend multicodec prefix for Ed25519 public key (0xed01)
 * 2. Encode as base58btc multibase (prefix 'z')
 * 3. Prepend 'did:syr:'
 *
 * @param publicKey - The Ed25519 public key (32 bytes).
 * @returns The did:syr identifier string.
 */
export function deriveDid(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new Error(
      `Expected 32-byte Ed25519 public key, got ${publicKey.length} bytes.`,
    );
  }

  // Prepend multicodec prefix
  const prefixed = new Uint8Array(
    ED25519_MULTICODEC_PREFIX.length + publicKey.length,
  );
  prefixed.set(ED25519_MULTICODEC_PREFIX);
  prefixed.set(publicKey, ED25519_MULTICODEC_PREFIX.length);

  // Encode as multibase base58btc
  const multibase = encodeMultibase(prefixed);

  return `did:syr:${multibase}`;
}
