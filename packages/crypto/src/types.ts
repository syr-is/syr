/**
 * An Ed25519 keypair.
 */
export interface Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * A rotation statement signed by the current root key,
 * authorizing a new root key to take over the identity.
 */
export interface RotationStatement {
  did: string;
  newRoot: string; // multibase-encoded new root public key
  rotatedAt: string; // ISO 8601 timestamp
  signature: string; // multibase-encoded Ed25519 signature
}
