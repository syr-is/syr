import { describe, it, expect } from "vitest";
import { buildDidDocument } from "../document.js";

const SAMPLE_DID = "did:syr:z6MkhaXgBZDvotDkL5LQ48B2Pz2KkJHNQwmfArFBkWYprLi3";
const SAMPLE_PUBKEY = "z6MkhaXgBZDvotDkL5LQ48B2Pz2KkJHNQwmfArFBkWYprLi3";

describe("buildDidDocument", () => {
  it("returns a valid DID Document structure", () => {
    const doc = buildDidDocument({
      did: SAMPLE_DID,
      publicKeyMultibase: SAMPLE_PUBKEY,
    });

    expect(doc.id).toBe(SAMPLE_DID);
    expect(doc["@context"]).toContain("https://www.w3.org/ns/did/v1");
    expect(doc["@context"]).toContain(
      "https://w3id.org/security/suites/ed25519-2020/v1",
    );
  });

  it("includes verificationMethod with correct structure", () => {
    const doc = buildDidDocument({
      did: SAMPLE_DID,
      publicKeyMultibase: SAMPLE_PUBKEY,
    });

    expect(doc.verificationMethod).toHaveLength(1);
    const vm = doc.verificationMethod[0];
    expect(vm.id).toBe("#root");
    expect(vm.type).toBe("Ed25519VerificationKey2020");
    expect(vm.controller).toBe(SAMPLE_DID);
    expect(vm.publicKeyMultibase).toBe(SAMPLE_PUBKEY);
  });

  it("includes authentication and assertionMethod references", () => {
    const doc = buildDidDocument({
      did: SAMPLE_DID,
      publicKeyMultibase: SAMPLE_PUBKEY,
    });

    expect(doc.authentication).toEqual(["#root"]);
    expect(doc.assertionMethod).toEqual(["#root"]);
  });

  it("includes service array when serviceEndpoint is provided", () => {
    const doc = buildDidDocument({
      did: SAMPLE_DID,
      publicKeyMultibase: SAMPLE_PUBKEY,
      serviceEndpoint: "https://provider.example.com",
    });

    expect(doc.service).toBeDefined();
    expect(doc.service).toHaveLength(1);
    expect(doc.service![0].id).toBe("#provider");
    expect(doc.service![0].type).toBe("SyrIdentityProvider");
    expect(doc.service![0].serviceEndpoint).toBe(
      "https://provider.example.com",
    );
  });

  it("omits service when no endpoint is provided", () => {
    const doc = buildDidDocument({
      did: SAMPLE_DID,
      publicKeyMultibase: SAMPLE_PUBKEY,
    });

    expect(doc.service).toBeUndefined();
  });
});
