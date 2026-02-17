import { sign, verify } from "./keys.js";
import {
  encodeMultibase,
  decodeMultibase,
  ED25519_MULTICODEC_PREFIX,
} from "./encoding.js";
import { canonicalize } from "./canonical.js";
import type { RotationStatement } from "./types.js";

/**
 * Create a root key rotation statement.
 *
 * This is signed by the CURRENT root key, authorizing the new root key
 * to take over the identity. The DID does not change.
 *
 * Phase 0: compile-level stub. No UI or API endpoint.
 *
 * @param did - The did:syr identifier.
 * @param newPublicKey - The new root public key (32 bytes).
 * @param currentPrivateKey - The current root private key (32 bytes).
 * @returns The signed rotation statement.
 */
export async function createRotationStatement(
  did: string,
  newPublicKey: Uint8Array,
  currentPrivateKey: Uint8Array,
): Promise<RotationStatement> {
  const prefixed = new Uint8Array(
    ED25519_MULTICODEC_PREFIX.length + newPublicKey.length,
  );
  prefixed.set(ED25519_MULTICODEC_PREFIX);
  prefixed.set(newPublicKey, ED25519_MULTICODEC_PREFIX.length);
  const newRoot = encodeMultibase(prefixed);
  const rotatedAt = new Date().toISOString();

  const payload = canonicalize({
    did,
    newRoot,
    rotatedAt,
  });

  const signatureBytes = await sign(payload, currentPrivateKey);
  const signature = encodeMultibase(signatureBytes);

  return {
    did,
    newRoot,
    rotatedAt,
    signature,
  };
}

/**
 * Verify a root key rotation statement.
 *
 * Checks that the rotation statement was signed by the current root key.
 *
 * @param statement - The rotation statement to verify.
 * @param currentPublicKey - The current root public key (32 bytes).
 * @returns True if the statement is valid.
 */
export async function verifyRotationStatement(
  statement: RotationStatement,
  currentPublicKey: Uint8Array,
): Promise<boolean> {
  const payload = canonicalize({
    did: statement.did,
    newRoot: statement.newRoot,
    rotatedAt: statement.rotatedAt,
  });

  const signatureBytes = decodeMultibase(statement.signature);
  return verify(payload, signatureBytes, currentPublicKey);
}
