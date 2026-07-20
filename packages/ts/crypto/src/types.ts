/**
 * An Ed25519 keypair.
 */
export interface Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * A rotation statement signed by the retiring root key, authorizing a new
 * root key to take over the identity. Statements form a per-DID chain; the
 * DID itself is derived from the genesis key and never changes.
 *
 * Signed payload (RFC 8785 JCS): { did, seq, prevRoot, newRoot, rotatedAt }.
 */
export interface RotationStatement {
  did: string;
  seq: number; // 1-based chain position; strictly increasing, no gaps
  prevRoot: string; // multibase-encoded key being retired (genesis for seq 1)
  newRoot: string; // multibase-encoded new root public key
  rotatedAt: string; // ISO 8601 timestamp
  signature: string; // multibase-encoded Ed25519 signature by prevRoot
}

/** Sigil (PIEF) KDF parameters */
export interface SigilKdf {
  name: string;
  salt: string;
  mem: number;
  it: number;
  par: number;
}

/** Sigil (PIEF) encryption parameters */
export interface SigilEnc {
  name: string;
  nonce: string;
  ct: string;
  tag: string;
}

/** Sigil (PIEF) encrypted object */
export interface SigilObject {
  v: number;
  kdf: SigilKdf;
  enc: SigilEnc;
  pub: string;
}

/** Aegis (CIGP) KDF parameters */
export interface AegisKdfParams {
  mem: number;
  it: number;
  par: number;
}

/** Aegis (CIGP) encrypted bundle */
export interface AegisBundle {
  pub: string;
  salt: string;
  nonce: string;
  ct: string;
  tag: string;
  kdf: AegisKdfParams;
}
