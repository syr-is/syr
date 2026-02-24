import { describe, it, expect } from "vitest";
import { isValidSyrDid } from "../validate.js";
import { deriveDid, generateRootKeypair } from "@syr-is/crypto";

describe("isValidSyrDid", () => {
  it("returns true for a valid did:syr identifier", async () => {
    const kp = await generateRootKeypair();
    const did = deriveDid(kp.publicKey);
    expect(isValidSyrDid(did)).toBe(true);
  });

  it("returns false for did:web", () => {
    expect(isValidSyrDid("did:web:example.com")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidSyrDid("")).toBe(false);
  });

  it("returns false for random string", () => {
    expect(isValidSyrDid("not-a-did")).toBe(false);
  });

  it("returns false for did:syr with invalid characters", () => {
    expect(isValidSyrDid("did:syr:z0OIl")).toBe(false);
  });
});
