/**
 * A parsed did:syr identifier.
 */
export interface ParsedDid {
  /** Always 'syr' for did:syr identifiers */
  method: "syr";
  /** The multibase-encoded method-specific identifier */
  id: string;
  /** The decoded Ed25519 public key (32 bytes) */
  publicKey: Uint8Array;
}

/**
 * An Ed25519 verification method in a DID Document.
 */
export interface VerificationMethod {
  id: string;
  type: "Ed25519VerificationKey2020";
  controller: string;
  publicKeyMultibase: string;
}

/**
 * A service endpoint in a DID Document.
 */
export interface ServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string;
}

/**
 * A DID Document for a did:syr identity.
 * Conforms to W3C DID Core; @context is required for JSON-LD.
 */
export interface DidDocument {
  "@context": string | Array<string | Record<string, unknown>>;
  id: string;
  verificationMethod: VerificationMethod[];
  authentication: string[];
  assertionMethod: string[];
  service?: ServiceEndpoint[];
}
