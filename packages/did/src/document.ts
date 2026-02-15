import type { DidDocument } from "./types.js";

/**
 * Build a DID Document for a did:syr identity.
 *
 * The document conforms to the did:syr Method Specification v0.1.
 * The `service` array is only included if `serviceEndpoint` is provided.
 *
 * @param input.did - The full did:syr identifier.
 * @param input.publicKeyMultibase - The multibase-encoded root public key (with multicodec prefix).
 * @param input.serviceEndpoint - Optional provider service endpoint URL.
 * @returns A DID Document.
 */
export function buildDidDocument(input: {
  did: string;
  publicKeyMultibase: string;
  serviceEndpoint?: string;
}): DidDocument {
  const { did, publicKeyMultibase, serviceEndpoint } = input;

  const doc: DidDocument = {
    "@context": "https://www.w3.org/ns/did/v1",
    id: did,
    verificationMethod: [
      {
        id: "#root",
        type: "Ed25519VerificationKey2020",
        controller: did,
        publicKeyMultibase,
      },
    ],
    authentication: ["#root"],
    assertionMethod: ["#root"],
  };

  if (serviceEndpoint) {
    doc.service = [
      {
        id: "#provider",
        type: "SyrIdentityProvider",
        serviceEndpoint,
      },
    ];
  }

  return doc;
}
