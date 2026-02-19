import { describe, it, expect } from "vitest";
// Import keys first to set up @noble/ed25519 SHA-512
import { generateRootKeypair } from "../keys.js";
import {
  createAegisBundle,
  decryptAegisBundle,
  type AegisBundle,
} from "../aegis.js";

describe("aegis", () => {
  it("round-trip: seed → createAegisBundle → decryptAegisBundle → seed matches", async () => {
    const kp = await generateRootKeypair();
    const seed = kp.privateKey;
    const password = "test-password-123";

    const bundle = await createAegisBundle(seed, password);
    expect(bundle.pub).toBeDefined();
    expect(bundle.salt).toBeDefined();
    expect(bundle.nonce).toBeDefined();
    expect(bundle.ct).toBeDefined();
    expect(bundle.tag).toBeDefined();
    expect(bundle.kdf).toEqual({ mem: 65536, it: 3, par: 1 });

    const recovered = await decryptAegisBundle(bundle, password);
    expect(recovered).toEqual(seed);
  });

  it("rejects wrong password", async () => {
    const kp = await generateRootKeypair();
    const bundle = await createAegisBundle(kp.privateKey, "correct");
    await expect(decryptAegisBundle(bundle, "wrong")).rejects.toThrow(
      "Aegis decryption failed",
    );
  });

  it("rejects tampered ciphertext", async () => {
    const kp = await generateRootKeypair();
    const bundle = await createAegisBundle(kp.privateKey, "pass");
    // Tamper the tag so GCM authentication fails
    const tampered: AegisBundle = {
      ...bundle,
      tag: bundle.tag.slice(0, -2) + "XX",
    };
    await expect(decryptAegisBundle(tampered, "pass")).rejects.toThrow(
      "Aegis decryption failed",
    );
  });

  it("rejects seed not 32 bytes", async () => {
    await expect(createAegisBundle(new Uint8Array(16), "pass")).rejects.toThrow(
      "Expected 32-byte seed",
    );
  });
});
