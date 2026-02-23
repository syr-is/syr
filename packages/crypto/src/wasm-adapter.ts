/**
 * WASM adapter: prefers @syr-is/crypto-wasm when available (browser),
 * falls back to TypeScript implementation (Node, SSR, or on init failure).
 */

import * as keys from "./keys.js";
import * as encoding from "./encoding.js";
import * as canonical from "./canonical.js";
import * as rotation from "./rotation.js";
import * as sigilTs from "./sigil-impl.js";
import * as aegisTs from "./aegis-impl.js";
import type { Keypair, RotationStatement } from "./types.js";

let wasm: Awaited<typeof import("@syr-is/crypto-wasm")> | null = null;
let wasmInitPromise: Promise<void> | null = null;

/**
 * Initialize the WASM crypto module. Call early in app lifecycle (e.g. root layout).
 * Safe to call multiple times. In Node/SSR, this no-ops and TS fallback is used.
 */
export async function initCryptoWasm(): Promise<void> {
  if (wasm) return;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    if (
      typeof window === "undefined" ||
      typeof globalThis.WebAssembly === "undefined"
    ) {
      return;
    }
    try {
      const mod = await import("@syr-is/crypto-wasm");
      await mod.default();
      wasm = mod;
    } catch {
      // Fall back to TS; wasm stays null
    }
  })();

  return wasmInitPromise;
}

function useWasm(): boolean {
  return wasm !== null;
}

// ---- Keys ----

export async function generateRootKeypair(): Promise<Keypair> {
  if (useWasm()) {
    const arr = wasm!.generate_root_keypair_wasm();
    return {
      publicKey: arr.slice(0, 32),
      privateKey: arr.slice(32, 64),
    };
  }
  return keys.generateRootKeypair();
}

export async function generateDeviceKeypair(): Promise<Keypair> {
  if (useWasm()) {
    const arr = wasm!.generate_device_keypair_wasm();
    return {
      publicKey: arr.slice(0, 32),
      privateKey: arr.slice(32, 64),
    };
  }
  return keys.generateDeviceKeypair();
}

export async function sign(
  payload: Uint8Array | string,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  const data =
    typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  if (useWasm()) {
    return wasm!.sign_wasm(data, privateKey);
  }
  return keys.sign(data, privateKey);
}

export async function verify(
  payload: Uint8Array | string,
  signature: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  const data =
    typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  if (useWasm()) {
    return wasm!.verify_wasm(data, signature, publicKey);
  }
  return keys.verify(data, signature, publicKey);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (useWasm()) {
    return wasm!.constant_time_equal_wasm(a, b);
  }
  return keys.constantTimeEqual(a, b);
}

// ---- Encoding ----

export function encodeMultibase(bytes: Uint8Array): string {
  if (useWasm()) {
    return wasm!.encode_multibase_wasm(bytes);
  }
  return encoding.encodeMultibase(bytes);
}

export function decodeMultibase(encoded: string): Uint8Array {
  if (useWasm()) {
    return wasm!.decode_multibase_wasm(encoded);
  }
  return encoding.decodeMultibase(encoded);
}

export function decodePublicKey(encoded: string): Uint8Array {
  if (useWasm()) {
    return wasm!.decode_public_key_wasm(encoded);
  }
  return encoding.decodePublicKey(encoded);
}

export function decodePrivateKey(encoded: string): Uint8Array {
  if (useWasm()) {
    return wasm!.decode_private_key_wasm(encoded);
  }
  return encoding.decodePrivateKey(encoded);
}

export function encodePrivateKey(raw: Uint8Array): string {
  if (useWasm()) {
    return wasm!.encode_private_key_wasm(raw);
  }
  return encoding.encodePrivateKey(raw);
}

export function deriveDid(publicKey: Uint8Array): string {
  if (useWasm()) {
    return wasm!.derive_did_wasm(publicKey);
  }
  return encoding.deriveDid(publicKey);
}

export const ED25519_MULTICODEC_PREFIX = encoding.ED25519_MULTICODEC_PREFIX;
export const ED25519_PRIV_MULTICODEC_PREFIX =
  encoding.ED25519_PRIV_MULTICODEC_PREFIX;

// ---- Canonical ----

export function canonicalize(obj: Record<string, unknown>): string {
  if (useWasm()) {
    return wasm!.canonicalize_wasm(JSON.stringify(obj));
  }
  return canonical.canonicalize(obj);
}

// ---- Rotation ----

export async function createRotationStatement(
  did: string,
  newPublicKey: Uint8Array,
  currentPrivateKey: Uint8Array,
): Promise<RotationStatement> {
  if (useWasm()) {
    const json = wasm!.create_rotation_statement_wasm(
      did,
      newPublicKey,
      currentPrivateKey,
    );
    return JSON.parse(json);
  }
  return rotation.createRotationStatement(did, newPublicKey, currentPrivateKey);
}

export async function verifyRotationStatement(
  statement: RotationStatement,
  currentPublicKey: Uint8Array,
): Promise<boolean> {
  if (useWasm()) {
    return wasm!.verify_rotation_statement_wasm(
      JSON.stringify(statement),
      currentPublicKey,
    );
  }
  return rotation.verifyRotationStatement(statement, currentPublicKey);
}

// ---- Sigil (re-exported from subpath; adapter wraps at subpath level) ----

export async function createSigil(
  seed: Uint8Array,
  passphrase: string,
): Promise<sigilTs.SigilObject> {
  if (useWasm()) {
    const json = wasm!.create_sigil_wasm(seed, passphrase);
    return JSON.parse(json);
  }
  return sigilTs.createSigil(seed, passphrase);
}

export async function decryptSigil(
  sigil: sigilTs.SigilObject,
  passphrase: string,
): Promise<Uint8Array> {
  if (useWasm()) {
    return wasm!.decrypt_sigil_wasm(JSON.stringify(sigil), passphrase);
  }
  return sigilTs.decryptSigil(sigil, passphrase);
}

// ---- Aegis ----

export async function createAegisBundle(
  seed: Uint8Array,
  password: string,
): Promise<aegisTs.AegisBundle> {
  if (useWasm()) {
    const json = wasm!.create_aegis_bundle_wasm(seed, password);
    return JSON.parse(json);
  }
  return aegisTs.createAegisBundle(seed, password);
}

export async function decryptAegisBundle(
  bundle: aegisTs.AegisBundle,
  password: string,
): Promise<Uint8Array> {
  if (useWasm()) {
    return wasm!.decrypt_aegis_bundle_wasm(JSON.stringify(bundle), password);
  }
  return aegisTs.decryptAegisBundle(bundle, password);
}
