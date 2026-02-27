/**
 * @syr-is/crypto
 * Cryptographic primitives for the Syr identity system.
 * Ed25519 key generation, multibase encoding, signing, verification, and JCS canonicalization.
 * Requires initCryptoWasm() before use.
 */

export { initCryptoWasm } from "./wasm-adapter.js";
export {
  generateRootKeypair,
  generateDeviceKeypair,
  sign,
  verify,
  constantTimeEqual,
  encodeMultibase,
  decodeMultibase,
  decodePublicKey,
  decodePrivateKey,
  encodePrivateKey,
  deriveDid,
  ED25519_MULTICODEC_PREFIX,
  ED25519_PRIV_MULTICODEC_PREFIX,
  canonicalize,
  createRotationStatement,
  verifyRotationStatement,
} from "./wasm-adapter.js";

export {
  generateEd25519KeyPairWebCrypto,
  signWithCryptoKey,
  exportPrivateKeyForStorage,
  importPrivateKeyFromStorage,
} from "./webcrypto.js";

export { personaIdFromPublicKey } from "./persona-id.js";

export type { Keypair, RotationStatement } from "./types.js";
export * from "./utils.js";
