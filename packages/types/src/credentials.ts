import { z } from "zod";
import { DIDSchema, type DID, BaseEntitySchema } from "./common.js";

/**
 * DID Document Schema
 * W3C DID Core specification
 */
export const DIDDocumentSchema = z.object({
  "@context": z.union([z.string(), z.array(z.string())]),
  id: DIDSchema,
  controller: z.union([DIDSchema, z.array(DIDSchema)]).optional(),
  verificationMethod: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        controller: DIDSchema,
        publicKeyJwk: z.record(z.string(), z.any()).optional(),
        publicKeyMultibase: z.string().optional(),
        publicKeyPem: z.string().optional(),
      })
    )
    .optional(),
  authentication: z
    .array(z.union([z.string(), z.record(z.string(), z.any())]))
    .optional(),
  assertionMethod: z
    .array(z.union([z.string(), z.record(z.string(), z.any())]))
    .optional(),
  keyAgreement: z
    .array(z.union([z.string(), z.record(z.string(), z.any())]))
    .optional(),
  capabilityInvocation: z
    .array(z.union([z.string(), z.record(z.string(), z.any())]))
    .optional(),
  capabilityDelegation: z
    .array(z.union([z.string(), z.record(z.string(), z.any())]))
    .optional(),
  service: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        serviceEndpoint: z.union([z.url(), z.array(z.url())]),
      })
    )
    .optional(),
});

export type DIDDocument = z.infer<typeof DIDDocumentSchema>;

/**
 * Credential Status Schema
 */
export const CredentialStatusSchema = z.object({
  id: z.url(),
  type: z.string(),
  statusPurpose: z.string().optional(),
  statusListIndex: z.string().optional(),
  statusListCredential: z.url().optional(),
});

export type CredentialStatus = z.infer<typeof CredentialStatusSchema>;

/**
 * Credential Subject Schema
 */
export const CredentialSubjectSchema = z
  .object({
    id: DIDSchema.optional(),
    type: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .catchall(z.any());

export type CredentialSubject = z.infer<typeof CredentialSubjectSchema>;

/**
 * Proof Schema
 * Data Integrity proof
 */
export const ProofSchema = z.object({
  type: z.string(),
  created: z.iso.datetime(),
  verificationMethod: z.string(),
  proofPurpose: z.string(),
  proofValue: z.string().optional(),
  jws: z.string().optional(),
  challenge: z.string().optional(),
  domain: z.string().optional(),
  nonce: z.string().optional(),
});

export type Proof = z.infer<typeof ProofSchema>;

/**
 * Verifiable Credential Schema
 * W3C Verifiable Credentials Data Model 2.0
 */
export const VerifiableCredentialSchema = z.object({
  "@context": z.union([
    z.string(),
    z.array(z.union([z.string(), z.record(z.string(), z.any())])),
  ]),
  id: z.url().optional(),
  type: z.union([z.string(), z.array(z.string())]),
  issuer: z.union([
    DIDSchema,
    z.object({
      id: DIDSchema,
      name: z.string().optional(),
    }),
  ]),
  issuanceDate: z.iso.datetime(),
  expirationDate: z.iso.datetime().optional(),
  credentialSubject: z.union([
    CredentialSubjectSchema,
    z.array(CredentialSubjectSchema),
  ]),
  credentialStatus: CredentialStatusSchema.optional(),
  proof: z.union([ProofSchema, z.array(ProofSchema)]).optional(),
  validFrom: z.iso.datetime().optional(),
  validUntil: z.iso.datetime().optional(),
  credentialSchema: z
    .object({
      id: z.url(),
      type: z.string(),
    })
    .optional(),
  termsOfUse: z
    .array(
      z.object({
        type: z.string(),
        id: z.url().optional(),
      })
    )
    .optional(),
  evidence: z.array(z.record(z.string(), z.any())).optional(),
  refreshService: z
    .object({
      id: z.url(),
      type: z.string(),
    })
    .optional(),
});

export type VerifiableCredential = z.infer<typeof VerifiableCredentialSchema>;

/**
 * Verifiable Presentation Schema
 * W3C Verifiable Presentations
 */
export const VerifiablePresentationSchema = z.object({
  "@context": z.union([
    z.string(),
    z.array(z.union([z.string(), z.record(z.string(), z.any())])),
  ]),
  id: z.url().optional(),
  type: z.union([z.string(), z.array(z.string())]),
  holder: DIDSchema,
  verifiableCredential: z.union([
    VerifiableCredentialSchema,
    z.array(VerifiableCredentialSchema),
  ]),
  proof: z.union([ProofSchema, z.array(ProofSchema)]).optional(),
});

export type VerifiablePresentation = z.infer<
  typeof VerifiablePresentationSchema
>;

/**
 * Stored Credential Schema
 * Internal representation in SurrealDB
 */
export const StoredCredentialSchema = BaseEntitySchema.extend({
  credential_id: z.url().optional(),
  issuer_did: DIDSchema,
  subject_did: DIDSchema,
  type: z.array(z.string()),
  credential_data: z.record(z.string(), z.any()),
  proof: z.record(z.string(), z.any()),
  issued_at: z.iso.datetime(),
  expires_at: z.iso.datetime().optional(),
  revoked: z.boolean().default(false),
});

export type StoredCredential = z.infer<typeof StoredCredentialSchema>;

/**
 * Stored Presentation Schema
 * Internal representation in SurrealDB
 */
export const StoredPresentationSchema = BaseEntitySchema.pick({
  id: true,
  created_at: true,
}).extend({
  presentation_id: z.url().optional(),
  holder_did: DIDSchema,
  verifiable_credentials: z.array(z.uuid()),
  proof: z.record(z.string(), z.any()),
});

export type StoredPresentation = z.infer<typeof StoredPresentationSchema>;

/**
 * Credential Issuance Request Schema
 */
export const CredentialIssuanceRequestSchema = z.object({
  subject_did: DIDSchema,
  type: z.array(z.string()),
  credential_subject: CredentialSubjectSchema,
  expiration_days: z.number().int().positive().optional(),
});

export type CredentialIssuanceRequest = z.infer<
  typeof CredentialIssuanceRequestSchema
>;

/**
 * Credential Verification Request Schema
 */
export const CredentialVerificationRequestSchema = z.object({
  credential: VerifiableCredentialSchema,
});

export type CredentialVerificationRequest = z.infer<
  typeof CredentialVerificationRequestSchema
>;

/**
 * Credential Verification Result Schema
 */
export const CredentialVerificationResultSchema = z.object({
  verified: z.boolean(),
  checks: z.array(z.string()),
  warnings: z.array(z.string()).optional(),
  errors: z.array(z.string()).optional(),
});

export type CredentialVerificationResult = z.infer<
  typeof CredentialVerificationResultSchema
>;

/**
 * Presentation Verification Request Schema
 */
export const PresentationVerificationRequestSchema = z.object({
  presentation: VerifiablePresentationSchema,
  challenge: z.string().optional(),
  domain: z.string().optional(),
});

export type PresentationVerificationRequest = z.infer<
  typeof PresentationVerificationRequestSchema
>;

/**
 * Presentation Verification Result Schema
 */
export const PresentationVerificationResultSchema = z.object({
  verified: z.boolean(),
  presentation_checks: z.array(z.string()),
  credential_results: z.array(CredentialVerificationResultSchema),
  warnings: z.array(z.string()).optional(),
  errors: z.array(z.string()).optional(),
});

export type PresentationVerificationResult = z.infer<
  typeof PresentationVerificationResultSchema
>;
