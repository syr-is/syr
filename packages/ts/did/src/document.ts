import * as wasm from "@syr-is/crypto/wasm";
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
  try {
    const json = wasm.build_did_document_wasm(
      input.did,
      input.publicKeyMultibase,
      input.serviceEndpoint ?? null,
    );
    return JSON.parse(json);
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}
