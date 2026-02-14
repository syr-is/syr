---
title: Syr Phase 0 Implementation Blueprint
---

# Syr Phase 0 Implementation Blueprint

## Context Reference for Humans and AI IDEs

---

# 1. Purpose of Phase 0

Phase 0 establishes **local-first, cryptographically real identity** inside the
existing Syr application.

After Phase 0:

- a user possesses a **self-sovereign root identity**
- profile actions are **cryptographically attributable**
- identity is **exportable and portable**
- groundwork exists for:
  - registry resolution
  - providers
  - OAuth
  - institutions

Phase 0 intentionally avoids:

- federation
- attestations
- advanced privacy
- social features
- moderation
- ActivityPub / VC

Focus is **identity correctness only**.

---

# 2. Phase 0 Success Criteria (Exit Conditions)

Phase 0 is complete when:

1. Root keypair is generated locally.
2. DID (did:syr) is derivable and stable.
3. Profile mutations are signed.
4. Identity bundle can be exported.
5. Delegated device key exists.
6. Basic key rotation path compiles (not UI-complete).

If any of the above is missing → Phase 0 is incomplete.

---

# 3. Repository Mapping

This blueprint assumes current monorepo structure:

```text
apps/
  syr/              ← SvelteKit web app (primary target)
  docs/             ← SveltePress docs app

packages/
  types/            ← shared schemas
  (future) crypto/  ← new: key + signing logic
  (future) did/     ← new: DID + resolver helpers
  (future) registry-client/ ← new later

apps/docs/src/routes/
  architecture/     ← architecture specs (identity-model, did-method, etc.)
  implementation/   ← implementation blueprints
```

---

# 4. New Packages to Create

## 4.1 packages/crypto

Purpose:
All key generation, signing, verification, export.

### Responsibilities

- Ed25519 key generation
- multibase encoding
- signature creation
- signature verification
- secure serialization helpers

### Public API (v0)

- `generateRootKey(): RootKeypair`
- `deriveDid(publicKey): DidString`
- `sign(payload, privateKey): Signature`
- `verify(payload, signature, publicKey): boolean`

No app logic here. Pure cryptography.

---

## 4.2 packages/did

Purpose:
Implement did:syr method logic.

### Responsibilities

- DID parsing
- DID document construction
- key extraction from DID
- local resolution helpers (registry later)

### Public API

- `parseDid(did): ParsedDid`
- `buildDidDocument(input): DidDocument`

No network calls in Phase 0.

---

# 5. Database Changes (SurrealDB)

Phase 0 requires **minimal new state**.

## 5.1 identity table

Stores local root identity metadata.

Fields:

- did (string, primary)
- publicKey (string, multibase)
- createdAt (datetime)

Never store private key here.

---

## 5.2 delegated_keys table

Stores device delegations.

Fields:

- id
- did
- publicKey
- createdAt
- expiresAt (nullable)
- revokedAt (nullable)
- signature (root-signed delegation)

---

## 5.3 Profile linkage update

Existing profile table must gain:

- did → owner reference

All profile writes must verify **valid delegation**.

---

# 6. SvelteKit Integration

## 6.1 First-run identity creation flow

On first authenticated session:

1. Call generateRootKey().
2. Derive DID.
3. Persist:
   - public key
   - DID
4. Create initial device delegation.
5. Store private keys in:
   - browser secure storage (acceptable for Phase 0)
   - future: native secure enclave.

---

## 6.2 Signing profile mutations

Every mutation must:

1. Serialize canonical payload.
2. Sign with device delegated key.
3. Attach signature to DB write.
4. Server verifies before accepting.

Unsigned writes must be rejected.

---

## 6.3 Identity export endpoint

Create:

`GET /api/identity/export`

Returns:

- DID
- public key
- delegated public keys
- signed profile snapshot

Never include private keys.

---

# 7. Minimal Key Rotation Path (Compile-Level Only)

Implement internal function:

`rotateRootKey(newKey)`

Must:

- create rotation statement
- append to local history structure

No UI required in Phase 0.
Goal is architectural readiness, not UX.

---

# 8. What MUST NOT be built in Phase 0

Do NOT implement:

- registry server
- OAuth provider
- attestations
- institutions
- federation
- messaging
- moderation
- webrings
- VC / ZK / blockchain

Any of the above → scope violation.

---

# 9. Phase 0 Implementation Order

Follow strictly:

1. packages/crypto
2. packages/did
3. DB schema updates
4. First-run identity creation
5. Delegated device signing
6. Signed profile mutations
7. Identity export endpoint
8. Stub key rotation

Do not reorder unless architecture changes.

---

# 10. Definition of Done

Phase 0 is complete when:

- deleting the server does not destroy identity
- exported bundle can be verified offline
- signatures prove authorship of profile data

At that moment:

Syr identity becomes **real**, not conceptual.

---

# 11. Next Phase After Completion

Immediately proceed to:

**Phase 1 — Registry + Provider portability**

Do not expand Phase 0 scope.

---

# End of Blueprint
