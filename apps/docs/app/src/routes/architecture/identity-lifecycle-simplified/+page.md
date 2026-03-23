---
title: Identity Lifecycle (Simplified — One DID, One Key)
---

# Identity Lifecycle (Simplified — One DID, One Key)

## 1. Purpose

Syr product architecture **defers** root key **rotation** and **recovery** flows as first-class features. This document states the **simplified lifecycle** so docs, roadmap, and implementation stay aligned: **one `did:syr` maps to one root keypair** for the lifetime of that identity on a provider.

For portability, users rely on **export / import** and **registry updates** (new provider URL), not on in-place cryptographic key rotation.

**Related**

- [Identity model](/architecture/identity-model)
- [Recovery & Rotation v0.1](/architecture/recovery-rotation) (historical spec; see §4 below)
- [Follows and timeline](/architecture/follows-and-timeline) (social features assume stable DIDs)

---

## 2. Rules

1. **No root rotation API** — The platform does not expose “rotate root key while keeping the same DID” as a supported path.
2. **No recovery-key ceremony** — No separate recovery key generation, threshold guardians, or social recovery as part of core identity v1.
3. **No append-only key history chain** — No required on-chain or in-DB rotation log for the simplified model.
4. **Changing keys means a new identity** — If a user must use a new root keypair, they create a **new DID** and move content via **export → import** on the new account (and update registry to point the old DID’s hosting record only if still migrating—that flow follows [import](/architecture/import) and registry protocol, not rotation).

**Delegation** (device keys) remains available for operational signing (see [Key hierarchy](/architecture/key-hierarchy-delegation)); delegation is not “rotation” of the root DID.

---

## 3. Relationship to migration

**Migration** (same DID, new provider) is unchanged: export bundle from provider A, import on provider B, update registry `provider` URL with a root-signed hosting record. The **DID and root key material** are the same; only hosting moves.

**New keys** → **new DID** → treat as **new person** from the protocol’s perspective unless you explicitly build a future “account linking” feature (out of scope here).

---

## 4. Status of Recovery & Rotation spec

The [Recovery & Rotation v0.1](/architecture/recovery-rotation) document remains in the tree as **reference material** for a possible future phase. It is **not** current product scope. The [spec-to-implementation map](/reference/spec-mapping) marks recovery/rotation items as **out of scope** until a future phase explicitly revives them.

---

## 5. Phase 0 blueprint alignment

[Phase 0 success criteria](/implementation/phase-0-blueprint) treat **exit condition 6** (basic key rotation path) as **not applicable** under this simplified model: **rotation is not supported**; **migration and export/import** are the supported portability paths.
