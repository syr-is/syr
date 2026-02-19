/**
 * Sigil (PIEF) - Portable Identity Export Format
 * Encrypts Ed25519 seed with export passphrase using Argon2id + AES-256-GCM.
 * AAD: "pief:v1"
 */

import { argon2id } from "hash-wasm";
import { getPublicKeyAsync } from "@noble/ed25519";
import { encodeMultibase } from "./encoding.js";
import { ED25519_MULTICODEC_PREFIX } from "./encoding.js";

const AAD = new TextEncoder().encode("pief:v1");
const SALT_LEN = 16;
const NONCE_LEN = 12;
const TAG_LEN = 16;
const KDF_MEM_KIB = 65536; // 64 MiB
const KDF_IT = 3;
const KDF_PAR = 1;
const KEY_LEN = 32;

/** Maximum Argon2 memory (KiB) to prevent DoS from malicious Sigils */
const MAX_ARGON2_MEMORY = 262144; // 256 MiB
/** Maximum Argon2 iterations */
const MAX_ARGON2_ITERS = 10;
/** Maximum Argon2 parallelism */
const MAX_ARGON2_PARALLELISM = 4;

const CHUNK_SIZE = 0x8000; // Avoid stack overflow for large inputs

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (b64.length % 4)) % 4;
  const padded = b64 + "=".repeat(pad);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export interface SigilKdf {
  name: string;
  salt: string;
  mem: number;
  it: number;
  par: number;
}

export interface SigilEnc {
  name: string;
  nonce: string;
  ct: string;
  tag: string;
}

export interface SigilObject {
  v: number;
  kdf: SigilKdf;
  enc: SigilEnc;
  pub: string;
}

/**
 * Derive encryption key from passphrase using Argon2id.
 */
async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  mem: number,
  it: number,
  par: number,
): Promise<Uint8Array> {
  const key = await argon2id({
    password: passphrase.normalize("NFKC"),
    salt,
    parallelism: par,
    iterations: it,
    memorySize: mem,
    hashLength: KEY_LEN,
    outputType: "binary",
  });
  return key as Uint8Array;
}

/**
 * Create a Sigil (PIEF) export object from a 32-byte Ed25519 seed and export passphrase.
 */
export async function createSigil(
  seed: Uint8Array,
  passphrase: string,
): Promise<SigilObject> {
  if (seed.length !== 32) {
    throw new Error(`Expected 32-byte seed, got ${seed.length}`);
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));

  const key = new Uint8Array(
    (await deriveKey(
      passphrase,
      salt,
      KDF_MEM_KIB,
      KDF_IT,
      KDF_PAR,
    )) as ArrayLike<number>,
  );
  const pubKey = await getPublicKeyAsync(seed);
  const pub = encodeMultibase(
    new Uint8Array([...ED25519_MULTICODEC_PREFIX, ...pubKey]),
  );

  const cipher = await crypto.subtle.importKey(
    "raw",
    key as unknown as BufferSource,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  const nonceBuf = nonce.buffer as ArrayBuffer;
  const aadBuf = AAD.buffer as ArrayBuffer;
  const seedBuf = seed.buffer.slice(
    seed.byteOffset,
    seed.byteOffset + seed.byteLength,
  ) as ArrayBuffer;
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonceBuf,
      tagLength: TAG_LEN * 8,
      additionalData: aadBuf,
    },
    cipher,
    seedBuf,
  );

  const ctWithTag = new Uint8Array(ciphertext);
  const ct = ctWithTag.subarray(0, -TAG_LEN);
  const tag = ctWithTag.subarray(-TAG_LEN);

  return {
    v: 1,
    kdf: {
      name: "argon2id",
      salt: base64urlEncode(salt),
      mem: KDF_MEM_KIB,
      it: KDF_IT,
      par: KDF_PAR,
    },
    enc: {
      name: "aes-256-gcm",
      nonce: base64urlEncode(nonce),
      ct: base64urlEncode(ct),
      tag: base64urlEncode(tag),
    },
    pub,
  };
}

/**
 * Decrypt a Sigil object with the export passphrase, returning the 32-byte seed.
 * Verifies the derived public key matches the stored `pub`.
 */
export async function decryptSigil(
  sigil: SigilObject,
  passphrase: string,
): Promise<Uint8Array> {
  if (sigil.v !== 1) {
    throw new Error(`Unsupported Sigil version: ${sigil.v}`);
  }
  if (sigil.kdf.name !== "argon2id" || sigil.enc.name !== "aes-256-gcm") {
    throw new Error("Unsupported KDF or cipher in Sigil");
  }

  const salt = base64urlDecode(sigil.kdf.salt);
  const nonce = base64urlDecode(sigil.enc.nonce);
  const ct = base64urlDecode(sigil.enc.ct);
  const tag = base64urlDecode(sigil.enc.tag);

  const mem = sigil.kdf.mem;
  const it = sigil.kdf.it;
  const par = sigil.kdf.par;
  if (
    typeof mem !== "number" ||
    typeof it !== "number" ||
    typeof par !== "number" ||
    !Number.isInteger(mem) ||
    !Number.isInteger(it) ||
    !Number.isInteger(par) ||
    mem < 1 ||
    mem > MAX_ARGON2_MEMORY ||
    it < 1 ||
    it > MAX_ARGON2_ITERS ||
    par < 1 ||
    par > MAX_ARGON2_PARALLELISM
  ) {
    throw new Error(
      `Invalid Sigil KDF parameters: mem/it/par must be positive integers within safe bounds`,
    );
  }

  const key = new Uint8Array(
    (await deriveKey(passphrase, salt, mem, it, par)) as ArrayLike<number>,
  );
  const cipher = await crypto.subtle.importKey(
    "raw",
    key as unknown as BufferSource,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const ctWithTag = new Uint8Array(ct.length + tag.length);
  ctWithTag.set(ct);
  ctWithTag.set(tag, ct.length);

  let seed: Uint8Array;
  try {
    const ctBuf = new Uint8Array(ctWithTag).buffer as ArrayBuffer;
    const nonceBuf = new Uint8Array(nonce).buffer as ArrayBuffer;
    const aadBuf = new Uint8Array(AAD).buffer as ArrayBuffer;
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonceBuf,
        tagLength: TAG_LEN * 8,
        additionalData: aadBuf,
      },
      cipher,
      ctBuf,
    );
    seed = new Uint8Array(plaintext);
  } catch {
    throw new Error(
      "Sigil decryption failed: wrong passphrase or corrupted data",
    );
  }

  if (seed.length !== 32) {
    throw new Error(`Invalid decrypted seed length: ${seed.length}`);
  }

  const derivedPub = await getPublicKeyAsync(seed);
  const derivedPubEncoded = encodeMultibase(
    new Uint8Array([...ED25519_MULTICODEC_PREFIX, ...derivedPub]),
  );
  if (derivedPubEncoded !== sigil.pub) {
    throw new Error("Sigil public key mismatch: decryption or data tampered");
  }

  return seed;
}
