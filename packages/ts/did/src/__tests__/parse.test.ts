import { describe, it, expect } from "vitest";
import { parseDid } from "../parse.js";
import {
  deriveDid,
  encodeMultibase,
  generateRootKeypair,
} from "@syr-is/crypto";

describe("parseDid", () => {
  it("correctly parses a valid did:syr identifier", async () => {
    const kp = await generateRootKeypair();
    const did = deriveDid(kp.publicKey);

    const parsed = parseDid(did);
    expect(parsed.method).toBe("syr");
    expect(parsed.id).toMatch(/^z[1-9A-HJ-NP-Za-km-z]+$/);
    expect(parsed.publicKey).toBeInstanceOf(Uint8Array);
    expect(parsed.publicKey.length).toBe(32);
    expect(parsed.publicKey).toEqual(kp.publicKey);
  });

  it("rejects did:web identifiers", () => {
    expect(() => parseDid("did:web:example.com")).toThrow(
      "Invalid did:syr format",
    );
  });

  it("rejects did:syr without z prefix", () => {
    expect(() => parseDid("did:syr:abc123")).toThrow("Invalid did:syr format");
  });

  it("rejects empty string", () => {
    expect(() => parseDid("")).toThrow("Invalid did:syr format");
  });

  it("rejects malformed colons", () => {
    expect(() => parseDid("did:syr:z:extra")).toThrow("Invalid did:syr format");
  });

  it("rejects string with only method", () => {
    expect(() => parseDid("did:syr")).toThrow("Invalid did:syr format");
  });

  it("rejects multibase with wrong multicodec prefix", () => {
    const wrongPrefix = new Uint8Array(34);
    wrongPrefix[0] = 0x00;
    wrongPrefix[1] = 0x00;
    const encoded = encodeMultibase(wrongPrefix);
    expect(() => parseDid(`did:syr:${encoded}`)).toThrow("multicodec prefix");
  });
});
