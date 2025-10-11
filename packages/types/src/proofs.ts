import { z } from "zod";
import { EventTypeSchema } from "./events.js";
import { BaseEntitySchema, DIDSchema } from "./common.js";

/**
 * Proof Type Schema
 */
export const ProofTypeSchema = z.enum([
  "event_attestation",
  "content_authorship",
  "interaction_proof",
  "reputation_proof",
  "custom",
]);

export type ProofType = z.infer<typeof ProofTypeSchema>;

/**
 * Proof Status Schema
 */
export const ProofStatusSchema = z.enum([
  "pending",
  "verified",
  "invalid",
  "revoked",
]);
export type ProofStatus = z.infer<typeof ProofStatusSchema>;

/**
 * Digital Proof Schema
 * Represents a cryptographic proof of an event or interaction
 */
export const DigitalProofSchema = BaseEntitySchema.pick({
  id: true,
  created_at: true,
}).extend({
  proof_type: ProofTypeSchema,
  user_id: z.uuid(),
  event_id: z.uuid().optional(),
  event_type: EventTypeSchema.optional(),
  claim: z.record(z.string(), z.any()),
  evidence: z.record(z.string(), z.any()),
  signature: z.string(),
  signature_algorithm: z.string().default("Ed25519"),
  issuer_did: DIDSchema,
  subject_did: DIDSchema,
  status: ProofStatusSchema,
  verified_at: z.iso.datetime().optional(),
  expires_at: z.iso.datetime().optional(),
});

export type DigitalProof = z.infer<typeof DigitalProofSchema>;

/**
 * Proof Creation Request Schema
 */
export const ProofCreationRequestSchema = z.object({
  proof_type: ProofTypeSchema,
  user_id: z.uuid(),
  event_id: z.uuid().optional(),
  claim: z.record(z.string(), z.any()),
  evidence: z.record(z.string(), z.any()),
  expires_in_days: z.number().int().positive().optional(),
});

export type ProofCreationRequest = z.infer<typeof ProofCreationRequestSchema>;

/**
 * Proof Verification Request Schema
 */
export const ProofVerificationRequestSchema = z.object({
  proof_id: z.uuid(),
  challenge: z.string().optional(),
});

export type ProofVerificationRequest = z.infer<
  typeof ProofVerificationRequestSchema
>;

/**
 * Proof Verification Result Schema
 */
export const ProofVerificationResultSchema = z.object({
  valid: z.boolean(),
  proof_id: z.uuid(),
  verified_at: z.coerce.date(),
  checks: z.array(
    z.object({
      check_name: z.string(),
      passed: z.boolean(),
      message: z.string().optional(),
    })
  ),
  warnings: z.array(z.string()).optional(),
  errors: z.array(z.string()).optional(),
});

export type ProofVerificationResult = z.infer<
  typeof ProofVerificationResultSchema
>;

/**
 * Proof Chain Schema
 * Links multiple proofs together
 */
export const ProofChainSchema = BaseEntitySchema.extend({
  user_id: z.uuid(),
  proofs: z.array(z.uuid()),
  chain_hash: z.string(),
});

export type ProofChain = z.infer<typeof ProofChainSchema>;

/**
 * Attestation Schema
 * Third-party attestation of a proof
 */
export const AttestationSchema = BaseEntitySchema.pick({
  id: true,
  created_at: true,
}).extend({
  proof_id: z.uuid(),
  attestor_did: DIDSchema,
  attestor_name: z.string().optional(),
  statement: z.string(),
  signature: z.string(),
});

export type Attestation = z.infer<typeof AttestationSchema>;

/**
 * Proof Submission Request Schema
 * For third-party services to submit proofs via SDK
 */
export const ProofSubmissionRequestSchema = z.object({
  user_id: z.string(),
  proof_type: ProofTypeSchema,
  claim: z.record(z.string(), z.any()),
  evidence: z.record(z.string(), z.any()),
  client_signature: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ProofSubmissionRequest = z.infer<
  typeof ProofSubmissionRequestSchema
>;

/**
 * Proof Submission Response Schema
 */
export const ProofSubmissionResponseSchema = z.object({
  proof_id: z.uuid(),
  status: ProofStatusSchema,
  credential_issued: z.boolean(),
  credential_id: z.uuid().optional(),
  message: z.string(),
});

export type ProofSubmissionResponse = z.infer<
  typeof ProofSubmissionResponseSchema
>;

/**
 * Proof Query Schema
 * For filtering and searching proofs
 */
export const ProofQuerySchema = z.object({
  user_id: z.uuid().optional(),
  proof_type: ProofTypeSchema.optional(),
  status: ProofStatusSchema.optional(),
  from_date: z.iso.datetime().optional(),
  to_date: z.iso.datetime().optional(),
  limit: z.number().int().positive().max(100).default(20),
  offset: z.number().int().nonnegative().default(0),
});

export type ProofQuery = z.infer<typeof ProofQuerySchema>;
