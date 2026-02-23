/**
 * Aegis (CIGP) - TypeScript implementation (fallback when WASM unavailable)
 */

import { argon2id } from "hash-wasm";
import { getPublicKeyAsync } from "@noble/ed25519";
import { encodeMultibase, ED25519_MULTICODEC_PREFIX } from "./encoding.js";

const AAD = new TextEncoder().encode("cigp:v1");
const SALT_LEN = 16;
const NONCE_LEN = 12;
const TAG_LEN = 16;
const KDF_MEM_KIB = 65536;
const KDF_IT = 3;
const KDF_PAR = 1;
const KEY_LEN = 32;

function base64urlEncode(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (b64.length % 4)) % 4;
  const padded = b64 + "=".repeat(pad);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export interface AegisKdfParams {
  mem: number;
  it: number;
  par: number;
}

export interface AegisBundle {
  pub: string;
  salt: string;
  nonce: string;
  ct: string;
  tag: string;
  kdf: AegisKdfParams;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  params: AegisKdfParams,
): Promise<Uint8Array> {
  const key = await argon2id({
    password: password.normalize("NFKC"),
    salt,
    parallelism: params.par,
    iterations: params.it,
    memorySize: params.mem,
    hashLength: KEY_LEN,
    outputType: "binary",
  });
  return key as Uint8Array;
}

export async function createAegisBundle(
  seed: Uint8Array,
  password: string,
): Promise<AegisBundle> {
  if (seed.length !== 32) {
    throw new Error(`Expected 32-byte seed, got ${seed.length}`);
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const kdf: AegisKdfParams = { mem: KDF_MEM_KIB, it: KDF_IT, par: KDF_PAR };

  const key = new Uint8Array(
    (await deriveKey(password, salt, kdf)) as ArrayLike<number>,
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
    pub,
    salt: base64urlEncode(salt),
    nonce: base64urlEncode(nonce),
    ct: base64urlEncode(ct),
    tag: base64urlEncode(tag),
    kdf,
  };
}

export async function decryptAegisBundle(
  bundle: AegisBundle,
  password: string,
): Promise<Uint8Array> {
  const salt = base64urlDecode(bundle.salt);
  const nonce = base64urlDecode(bundle.nonce);
  const ct = base64urlDecode(bundle.ct);
  const tag = base64urlDecode(bundle.tag);

  const key = new Uint8Array(
    (await deriveKey(password, salt, bundle.kdf)) as ArrayLike<number>,
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
    const seed = new Uint8Array(plaintext);
    if (seed.length !== 32) {
      throw new Error(`Invalid decrypted seed length: ${seed.length}`);
    }
    return seed;
  } catch {
    throw new Error(
      "Aegis decryption failed: wrong password or corrupted bundle",
    );
  }
}
