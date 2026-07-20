/**
 * WASM adapter for Syr crypto. Requires initCryptoWasm() before use.
 */

import type {
  Keypair,
  RotationStatement,
  SigilObject,
  AegisBundle,
} from "./types.js";

let wasm: Awaited<typeof import("@syr-is/crypto/wasm")> | null = null;
let wasmInitPromise: Promise<void> | null = null;

/**
 * Initialize the WASM crypto module. Call early in app lifecycle (e.g. root layout).
 * Safe to call multiple times. Throws if WebAssembly is unavailable or init fails.
 */
export async function initCryptoWasm(): Promise<void> {
  if (wasm) return;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    if (typeof globalThis.WebAssembly === "undefined") {
      throw new Error("WebAssembly is not supported in this environment");
    }
    const mod = await import("@syr-is/crypto/wasm");
    // Node build loads WASM synchronously; web build has async default init
    if (typeof mod.default === "function") {
      await mod.default();
    }
    wasm = mod;
  })();

  return wasmInitPromise;
}

function getWasm() {
  if (!wasm) {
    throw new Error(
      "Crypto WASM not initialized. Call initCryptoWasm() before using crypto functions.",
    );
  }
  return wasm;
}

// ---- Keys ----

export async function generateRootKeypair(): Promise<Keypair> {
  const arr = getWasm().generate_root_keypair_wasm();
  return {
    publicKey: arr.slice(0, 32),
    privateKey: arr.slice(32, 64),
  };
}

export async function generateDeviceKeypair(): Promise<Keypair> {
  const arr = getWasm().generate_device_keypair_wasm();
  return {
    publicKey: arr.slice(0, 32),
    privateKey: arr.slice(32, 64),
  };
}

export async function sign(
  payload: Uint8Array | string,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  const data =
    typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  return getWasm().sign_wasm(data, privateKey);
}

export async function verify(
  payload: Uint8Array | string,
  signature: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  const data =
    typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  return getWasm().verify_wasm(data, signature, publicKey);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return getWasm().constant_time_equal_wasm(a, b);
}

// ---- Encoding ----

export function encodeMultibase(bytes: Uint8Array): string {
  return getWasm().encode_multibase_wasm(bytes);
}

/**
 * Decode a multibase base58btc string to bytes.
 * @throws {Error} Invalid input (e.g. wrong prefix, malformed encoding).
 */
export function decodeMultibase(encoded: string): Uint8Array {
  try {
    return getWasm().decode_multibase_wasm(encoded);
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}

/**
 * Decode a multibase-encoded Ed25519 public key.
 * @throws {Error} Invalid input (e.g. wrong multicodec prefix, wrong length).
 */
export function decodePublicKey(encoded: string): Uint8Array {
  try {
    return getWasm().decode_public_key_wasm(encoded);
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}

/**
 * Decode a multibase-encoded Ed25519 private key.
 * @throws {Error} Invalid input (e.g. wrong multicodec prefix, wrong length).
 */
export function decodePrivateKey(encoded: string): Uint8Array {
  try {
    return getWasm().decode_private_key_wasm(encoded);
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}

/**
 * Encode raw private key bytes as multibase.
 * @throws {Error} Invalid input (e.g. wrong length).
 */
export function encodePrivateKey(raw: Uint8Array): string {
  try {
    return getWasm().encode_private_key_wasm(raw);
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}

/**
 * Derive a did:syr identifier from a 32-byte public key.
 * @throws {Error} Invalid input (e.g. public key not 32 bytes).
 */
export function deriveDid(publicKey: Uint8Array): string {
  try {
    return getWasm().derive_did_wasm(publicKey);
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}

export {
  ED25519_MULTICODEC_PREFIX,
  ED25519_PRIV_MULTICODEC_PREFIX,
} from "./constants.js";

// ---- Canonical ----

export function canonicalize(obj: Record<string, unknown>): string {
  return getWasm().canonicalize_wasm(JSON.stringify(obj));
}

// ---- Rotation ----

/**
 * Create a rotation statement for chain position `seq` (1-based), signed by
 * the retiring root key. `prevRoot` is derived from `currentPrivateKey`.
 */
export async function createRotationStatement(
  did: string,
  seq: number,
  newPublicKey: Uint8Array,
  currentPrivateKey: Uint8Array,
): Promise<RotationStatement> {
  const json = getWasm().create_rotation_statement_wasm(
    did,
    seq,
    newPublicKey,
    currentPrivateKey,
  );
  return JSON.parse(json);
}

export async function verifyRotationStatement(
  statement: RotationStatement,
  currentPublicKey: Uint8Array,
): Promise<boolean> {
  return getWasm().verify_rotation_statement_wasm(
    JSON.stringify(statement),
    currentPublicKey,
  );
}

/**
 * Verify a full rotation chain for `did` (link, seq continuity, signatures,
 * non-decreasing rotatedAt) and return the current root public key.
 * An empty chain resolves to the genesis key derived from the DID.
 * @throws {Error} When the chain is invalid.
 */
export async function verifyRotationChain(
  did: string,
  statements: RotationStatement[],
): Promise<Uint8Array> {
  try {
    return getWasm().verify_rotation_chain_wasm(
      did,
      JSON.stringify(statements),
    );
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}

/**
 * Derive the Ed25519 public key from a 32-byte private-key seed.
 * @throws {Error} Invalid input (e.g. seed not 32 bytes).
 */
export function derivePublicKeyFromSeed(seed: Uint8Array): Uint8Array {
  try {
    return getWasm().derive_public_key_from_seed_wasm(seed);
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}

// ---- Sigil ----

export async function createSigil(
  seed: Uint8Array,
  passphrase: string,
): Promise<SigilObject> {
  const json = getWasm().create_sigil_wasm(seed, passphrase);
  return JSON.parse(json);
}

export async function decryptSigil(
  sigil: SigilObject,
  passphrase: string,
): Promise<Uint8Array> {
  return getWasm().decrypt_sigil_wasm(JSON.stringify(sigil), passphrase);
}

// ---- Aegis ----

export async function createAegisBundle(
  seed: Uint8Array,
  password: string,
): Promise<AegisBundle> {
  const json = getWasm().create_aegis_bundle_wasm(seed, password);
  return JSON.parse(json);
}

export async function decryptAegisBundle(
  bundle: AegisBundle,
  password: string,
): Promise<Uint8Array> {
  return getWasm().decrypt_aegis_bundle_wasm(JSON.stringify(bundle), password);
}
