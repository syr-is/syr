import { describe, it, expect } from "vitest";
import { generateRootKeypair } from "../keys.js";
import {
  encodeMultibase,
  decodePrivateKey,
  ED25519_PRIV_MULTICODEC_PREFIX,
} from "../encoding.js";
import { concatBytes } from "../utils.js";
import {
  exportPrivateKeyToEncryptedPem,
  importPrivateKeyFromEncryptedPem,
  rawToPkcs8Der,
  extractRawKeyFromPkcs8,
} from "../pem.js";

describe("pem", () => {
  it("round-trip: raw → pkcs8 → pem(encrypted) → import → raw matches", async () => {
    const kp = await generateRootKeypair();
    const prefixed = concatBytes(ED25519_PRIV_MULTICODEC_PREFIX, kp.privateKey);
    const multibase = encodeMultibase(prefixed);

    const pem = exportPrivateKeyToEncryptedPem(multibase, "test-passphrase");
    expect(pem).toContain("-----BEGIN ENCRYPTED PRIVATE KEY-----");
    expect(pem).toContain("-----END ENCRYPTED PRIVATE KEY-----");

    const recovered = importPrivateKeyFromEncryptedPem(pem, "test-passphrase");
    const raw = decodePrivateKey(recovered);
    expect(Buffer.from(raw)).toEqual(Buffer.from(kp.privateKey));
  });

  it("OpenSSL compatibility: generated PEM works with openssl pkey", async () => {
    const kp = await generateRootKeypair();
    const prefixed = concatBytes(ED25519_PRIV_MULTICODEC_PREFIX, kp.privateKey);
    const multibase = encodeMultibase(prefixed);
    const pem = exportPrivateKeyToEncryptedPem(multibase, "xxx");
    const { execSync } = await import("node:child_process");
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "pem-test-"));
    const f = join(dir, "key.pem");
    try {
      writeFileSync(f, pem);
      try {
        const out = execSync(
          `openssl pkey -in "${f}" -passin env:PEMTEST_PASS -text`,
          {
            encoding: "utf-8",
            maxBuffer: 10_000,
            env: { ...process.env, PEMTEST_PASS: "xxx" },
          },
        );
        expect(out).toContain("ED25519");
      } catch (e) {
        // OpenSSL may fail in headless envs (tty issues). Skip if so.
        if (String(e).includes("unable to get passphrase")) {
          return;
        }
        throw e;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("WebCrypto import: PKCS#8 DER imports via crypto.subtle.importKey", async () => {
    const kp = await generateRootKeypair();
    const der = rawToPkcs8Der(kp.privateKey);
    const key = await crypto.subtle.importKey(
      "pkcs8",
      new Uint8Array(der),
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    expect(key.type).toBe("private");
    expect(key.algorithm?.name).toBe("Ed25519");
  });

  it("rejects malformed: missing nested OCTET STRING", () => {
    const badDer = Buffer.from([
      0x30,
      0x2e,
      0x02,
      0x01,
      0x00,
      0x30,
      0x05,
      0x06,
      0x03,
      0x2b,
      0x65,
      0x70,
      0x04,
      0x20, // Direct 32 bytes, no nested 04 22 04 20
      ...new Array(32).fill(0),
    ]);
    expect(() => extractRawKeyFromPkcs8(badDer)).toThrow(
      "Invalid PKCS#8 Ed25519 private key",
    );
  });

  it("rejects malformed: wrong seed length", () => {
    const shortDer = rawToPkcs8Der(new Uint8Array(32).fill(1));
    const tweaked = Buffer.from(shortDer);
    tweaked[13] = 0x21; // Change 0x22 to 0x21 (33 bytes) - breaks structure
    expect(() => extractRawKeyFromPkcs8(tweaked)).toThrow(
      "Invalid PKCS#8 Ed25519 private key",
    );
  });
});
