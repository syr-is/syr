---
title: Identity Lifecycle (One DID, Rotating Root Keys)
---

# Identity Lifecycle (One DID, Rotating Root Keys)

## 1. Purpose

This document states the identity lifecycle so docs, roadmap, and implementation stay aligned: **one `did:syr` for the lifetime of the identity**, anchored to the **genesis root key** encoded in the identifier, with the _current_ root key resolved through an append-only **rotation chain**.

**Related**

- [Identity model](/architecture/identity-model)
- [Root key rotation](/architecture/recovery-rotation) — chain format, validation, flows
- [Follows and timeline](/architecture/follows-and-timeline) (social features assume stable DIDs)

---

## 2. Rules

1. **The DID never changes** — `did:syr:z…` encodes the _genesis_ Ed25519 key and is fixed at creation. Rotation moves the _current_ root key, not the identifier.
2. **Root rotation is a first-class API** — `POST /api/identity/rotate` appends a signed statement to the per-DID chain (custodial `aegis` mode or self-custody `external` mode). See [Root key rotation](/architecture/recovery-rotation).
3. **Key history is an append-only chain** — each statement is signed by the retiring key; verifiers replay the chain from the genesis key to derive the current root. The chain is public (`GET /api/identity/{did}/rotations`, advertised in the per-identity manifest).
4. **Rotation requires possession** — the Aegis password (custodial) or an external signer holding the seed (Syner). **Recovery keys are out of scope for v1**: a lost root key with no custodial seed cannot be rotated away; that case remains "new DID + export/import".
5. **Delegation** (device keys) remains available for operational signing (see [Key hierarchy](/architecture/key-hierarchy-delegation)); delegation is not rotation of the root.

---

## 3. Relationship to migration

**Migration** (same DID, new provider) is unchanged: export bundle from provider A, import on provider B, update registry `provider` URL with a root-signed hosting record. Rotation composes with migration: hosting records are signed by the **current** root key and carry the rotation chain so registries and resolvers can verify them (see [registry protocol](/architecture/registry-protocol)).

**Lost keys without Aegis** → **new DID** → treat as a new identity from the protocol's perspective; move content via **export → import**.

---

## 4. Status of the rotation spec

[Root key rotation](/architecture/recovery-rotation) is the **implemented v1 spec** (chain format, JCS payload, validation rules, custodial + external flows, delegation validity policy). Recovery keys and social/threshold recovery stay **out of scope** until a future phase explicitly picks them up. The [spec-to-implementation map](/reference/spec-mapping) tracks per-requirement status.

---

## 5. Phase 0 blueprint alignment

[Phase 0 success criteria](/implementation/phase-0-blueprint) exit condition 6 (basic key rotation path) is **met** by the chain-based rotation API: rotation preserves the DID, past signatures stay auditable, and registry records are re-signed under the new root.
