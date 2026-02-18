/**
 * PKCS#8 PEM helpers for Ed25519 key export/import with encryption.
 * Node.js implementation — uses node:crypto. RFC 8410 compliant.
 */

import { createPrivateKey } from "node:crypto";
import type { KeyObject } from "node:crypto";
import {
  decodePrivateKey,
  encodeMultibase,
  ED25519_MULTICODEC_PREFIX,
} from "./encoding.js";

/** Ed25519 OID: 1.3.101.112 */
const ED25519_OID = new Uint8Array([0x06, 0x03, 0x2b, 0x65, 0x70]);

export function encodeDerLength(len: number): Buffer {
  if (len < 0) throw new Error("DER length must be non-negative");
  if (len > 0xffffffff) throw new Error("DER length too large");
  if (len < 128) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function rawToPkcs8Der(raw: Uint8Array): Buffer {
  if (raw.length !== 32) {
    throw new Error(`Expected 32-byte Ed25519 key, got ${raw.length}`);
  }
  const innerOctet = Buffer.alloc(34); // 04 20 [32] = 34 bytes
  innerOctet[0] = 0x04;
  innerOctet[1] = 0x20;
  raw.forEach((b, i) => (innerOctet[2 + i] = b));
  const privKeyLen = encodeDerLength(innerOctet.length); // 34
  const privKey = Buffer.alloc(1 + privKeyLen.length + innerOctet.length);
  let off = 0;
  privKey[off++] = 0x04;
  privKeyLen.copy(privKey, off);
  off += privKeyLen.length;
  innerOctet.copy(privKey, off);

  const algoLen = encodeDerLength(ED25519_OID.length);
  const algoSeq = Buffer.concat([
    Buffer.from([0x30]),
    algoLen,
    Buffer.from(ED25519_OID),
  ]);

  const content = Buffer.concat([
    Buffer.from([0x02, 0x01, 0x00]),
    algoSeq,
    privKey,
  ]);
  const seqLen = encodeDerLength(content.length);
  return Buffer.concat([Buffer.from([0x30]), seqLen, content]);
}

function parseDerLength(
  der: Buffer,
  off: number,
): { value: number; numBytes: number } {
  if (off >= der.length) throw new Error("Invalid PKCS#8 Ed25519 private key");
  const b = der[off]!;
  if (b < 128) return { value: b, numBytes: 1 };
  const numLenBytes = b & 0x7f;
  if (numLenBytes > 4 || off + 1 + numLenBytes > der.length)
    throw new Error("Invalid PKCS#8 Ed25519 private key");
  let value = 0;
  for (let i = 0; i < numLenBytes; i++)
    value = (value << 8) | der[off + 1 + i]!;
  return { value, numBytes: 1 + numLenBytes };
}

export function extractRawKeyFromPkcs8(der: Buffer): Uint8Array {
  if (der.length < 48) throw new Error("Invalid PKCS#8 Ed25519 private key");
  let off = 0;
  if (der[off++] !== 0x30)
    throw new Error("Invalid PKCS#8 Ed25519 private key");
  const { value: seqLen, numBytes: seqLenBytes } = parseDerLength(der, off);
  off += seqLenBytes;
  if (off + seqLen > der.length)
    throw new Error("Invalid PKCS#8 Ed25519 private key");
  const seqEnd = off + seqLen;
  if (der[off++] !== 0x02 || der[off++] !== 0x01)
    throw new Error("Invalid PKCS#8 Ed25519 private key");
  off += 1;
  if (der[off++] !== 0x30)
    throw new Error("Invalid PKCS#8 Ed25519 private key");
  const { value: algoLen, numBytes: algoLenBytes } = parseDerLength(der, off);
  off += algoLenBytes;
  if (off + algoLen > seqEnd)
    throw new Error("Invalid PKCS#8 Ed25519 private key");
  if (algoLen !== ED25519_OID.length)
    throw new Error("Invalid PKCS#8 Ed25519 private key");
  for (let i = 0; i < ED25519_OID.length; i++)
    if (der[off + i] !== ED25519_OID[i])
      throw new Error("Invalid PKCS#8 Ed25519 private key");
  off += ED25519_OID.length;
  if (der[off++] !== 0x04)
    throw new Error("Invalid PKCS#8 Ed25519 private key");
  const { value: privLen, numBytes: privLenBytes } = parseDerLength(der, off);
  off += privLenBytes;
  if (privLen !== 34 || off + 34 > der.length || off + 34 > seqEnd)
    throw new Error("Invalid PKCS#8 Ed25519 private key");
  if (der[off] !== 0x04 || der[off + 1] !== 0x20)
    throw new Error("Invalid PKCS#8 Ed25519 private key");
  return new Uint8Array(der.subarray(off + 2, off + 34));
}

export function exportPrivateKeyToEncryptedPem(
  multibasePrivateKey: string,
  passphrase: string,
): string {
  const raw = decodePrivateKey(multibasePrivateKey);
  if (raw.length !== 32) {
    throw new Error(`Expected 32-byte Ed25519 key, got ${raw.length}`);
  }
  const pkcs8Der = rawToPkcs8Der(raw);
  const keyObject = createPrivateKey({
    key: pkcs8Der,
    format: "der",
    type: "pkcs8",
  });
  return keyObject.export({
    type: "pkcs8",
    format: "pem",
    cipher: "aes-256-cbc",
    passphrase,
  }) as string;
}

export function importPrivateKeyFromEncryptedPem(
  pem: string,
  passphrase: string,
): string {
  const keyObject = createPrivateKey({
    key: pem,
    format: "pem",
    passphrase,
  }) as KeyObject;
  const exp = keyObject.export({ type: "pkcs8", format: "der" });
  const der = Buffer.isBuffer(exp) ? exp : Buffer.from(exp as string, "binary");
  const raw = extractRawKeyFromPkcs8(der);
  const prefixed = new Uint8Array(
    ED25519_MULTICODEC_PREFIX.length + raw.length,
  );
  prefixed.set(ED25519_MULTICODEC_PREFIX);
  prefixed.set(raw, ED25519_MULTICODEC_PREFIX.length);
  return encodeMultibase(prefixed);
}
