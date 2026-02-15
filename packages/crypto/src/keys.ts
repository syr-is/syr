import * as ed from "@noble/ed25519";
import type { Keypair } from "./types.js";

// noble/ed25519 v2 requires a SHA-512 implementation.
// Use the Web Crypto API (available in Node 18+ and all modern browsers).
ed.etc.sha512Async = async (...messages: Uint8Array[]): Promise<Uint8Array> => {
  const merged = concatBytes(...messages);
  const buf = merged.buffer.slice(
    merged.byteOffset,
    merged.byteOffset + merged.byteLength,
  ) as ArrayBuffer;
  const hash = await crypto.subtle.digest("SHA-512", buf);
  return new Uint8Array(hash);
};

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (const arr of arrays) totalLength += arr.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Constant-time comparison of two byte arrays.
 * Use for comparing keys or tokens to avoid timing side channels.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

/**
 * Generate an Ed25519 root keypair.
 * The root key is the ultimate trust anchor for the identity.
 * It should be used rarely and stored securely.
 */
export async function generateRootKeypair(): Promise<Keypair> {
  return generateKeypair();
}

/**
 * Generate an Ed25519 device keypair.
 * Device keys are used for daily operations and delegated by the root key.
 */
export async function generateDeviceKeypair(): Promise<Keypair> {
  return generateKeypair();
}

/**
 * Generate an Ed25519 keypair.
 */
async function generateKeypair(): Promise<Keypair> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { publicKey, privateKey };
}

/**
 * Sign a payload with an Ed25519 private key.
 * @param payload - The data to sign (string or Uint8Array). Strings are encoded as UTF-8.
 * @param privateKey - The Ed25519 private key (32 bytes).
 * @returns The Ed25519 signature (64 bytes).
 */
export async function sign(
  payload: Uint8Array | string,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  const data =
    typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  return ed.signAsync(data, privateKey);
}

/**
 * Verify an Ed25519 signature.
 * @param payload - The original data that was signed. Strings are encoded as UTF-8.
 * @param signature - The Ed25519 signature (64 bytes).
 * @param publicKey - The Ed25519 public key (32 bytes).
 * @returns True if the signature is valid.
 */
export async function verify(
  payload: Uint8Array | string,
  signature: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  const data =
    typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  try {
    return await ed.verifyAsync(signature, data, publicKey);
  } catch {
    return false;
  }
}
