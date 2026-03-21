---
title: Signed Profile and Post Mutations
---

# Signed Profile and Post Mutations

## 1. Purpose

Every **profile** and **post** mutation (create, update, and any defined delete) MUST carry a **cryptographic signature** proving the **identity owner** authorized the content. The server **verifies** the signature using the **public key implied by the user’s `did:syr`**.

This aligns Phase 0’s goal that **profile mutations are signed** and extends the same integrity model to **posts**.

**Related**

- [Identity lifecycle (simplified)](/architecture/identity-lifecycle-simplified)
- [did:syr method](/architecture/did-method) — DID encodes the root public key
- [Registry protocol](/architecture/registry-protocol) — JCS + Ed25519 for hosting records (same canonicalization discipline)
- [Signature verification UI](/architecture/signature-verification-ui) — user-visible checks

**Implementation note:** `apps/syr` already includes `identityController.verifySignedMutation()` in `apps/syr/app/src/lib/controllers/identity.controller.ts`, which today verifies payloads with a **delegated device** key and re-checks delegation against the root. The **product target** below is **root-attributable content**: either sign with the root key directly or sign with a delegated key that is explicitly treated as acting for the DID; verification MUST end in a statement verifiable against the **DID’s root public key** (directly or via delegation). Converge implementation on one documented path when enforcing this spec.

---

## 2. Canonical payload

### 2.1 Serialization

- Payloads are signed over the **RFC 8785 JSON Canonicalization Scheme (JCS)** UTF-8 bytes of a **deterministic JSON object** (sorted keys, no insignificant whitespace), matching usage in `@syr-is/crypto` (`canonicalize()`).

### 2.2 Profile mutations

Signed object SHOULD include at minimum:

| Field                                             | Description                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `type`                                            | Literal `"profile"` (or versioned `"profile@v1"`).                                                                 |
| `did`                                             | Subject `did:syr:...` (must match authenticated identity).                                                         |
| `display_name`, `bio`, `avatar_url`, `banner_url` | Full **snapshot** of profile fields being committed (omit or `null` for cleared optional fields per schema rules). |

**Updates:** Sign the **full new state** of the profile fields under this spec (not a minimal delta), so verifiers and UI can re-run one verification path.

### 2.3 Post mutations

Signed object SHOULD include at minimum:

| Field                               | Description                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `type`                              | Literal `"post"` (or versioned `"post@v1"`).                                                           |
| `did`                               | Author `did:syr:...`.                                                                                  |
| `post_id`                           | Composite id `{ created_by, id }` or stable string form used by the API (must match stored record).    |
| `title`, `body`, `type` (post type) | Content snapshot as applicable.                                                                        |
| `media_urls`                        | Array or omitted per schema.                                                                           |
| `created_at`                        | ISO-8601 from server or client per policy (document whether server timestamps overwrite after verify). |

**Creates:** Include all fields that will be persisted. **Updates:** Full snapshot of post fields after the edit.

### 2.4 Deletes

If soft/hard delete is signed, include `type: "post_delete"` / `"profile_delete"`, `did`, target ids, and a **monotonic** `deleted_at` or version counter so replays are detectable. Exact shape is implementation-defined but MUST be JCS-signed the same way.

---

## 3. Signature format

- **Algorithm:** Ed25519.
- **Signature encoding:** multibase (consistent with other Syr surfaces), unless the API explicitly standardizes another encoding; document the chosen encoding in OpenAPI/types.
- **Signer:** Root private key **or** a delegated key only if verification chain proves delegation from that root (see §1 implementation note).

---

## 4. API contract (target)

Requests that mutate profile or posts (for users with an identity) SHOULD include:

| Field          | Description                                                                              |
| -------------- | ---------------------------------------------------------------------------------------- |
| `signature`    | Multibase-encoded Ed25519 signature over `canonicalize(payloadObject)`.                  |
| Payload fields | Either nested under `payload` or flattened with `signature` alongside, per route design. |

**Responses**

- **`400` / `SIGNATURE_REQUIRED`** — User has a DID but no signature provided.
- **`400` / `SIGNATURE_INVALID`** — Canonical bytes do not verify.
- **`403` / `DID_MISMATCH`** — Payload `did` does not match the authenticated user’s identity.

---

## 5. Enforcement

- **Middleware or shared handler** on `POST`/`PATCH`/`DELETE` (as applicable) for profile and post routes: if `locals.user` has an **identity (DID)**, require successful verification before writing.
- Users **without** an identity may remain unsigned-only until identity creation is mandatory (product choice).
- **Idempotency:** Re-submitting the same signed payload should not create duplicate posts if `post_id` is client-assigned ULID; server should define behavior.

---

## 6. Persistence for verification

Store alongside the resource (or in a side table):

- `signature` (multibase)
- Optional `signed_payload` canonical JSON string or reconstructible field set
- `signed_at` if useful for UX

Public read endpoints (when added for timelines) MUST return enough data for [verification UI](/architecture/signature-verification-ui) to re-canonicalize and verify offline.

---

## 7. Roadmap linkage

Matches Phase 0 **Remaining** items:

- Enforce signed mutations on **all** profile/post writes.
- **Signed mutation middleware** for API routes.

---

## 8. Open decisions (before implementation)

1. Root-only signing from Syner vs delegated-key signing with mandatory delegation check on every write.
2. Whether server **normalizes** timestamps after verify and includes them in the signed blob or signs client timestamps only.
3. Exact Zod schemas in `@syr-is/types` for `ProfileSignedPayload` / `PostSignedPayload`.
