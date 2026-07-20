---
title: did:syr Method Specification v0.1
---

# did:syr Method Specification v0.1

## 1. Overview

The **did:syr** method defines a decentralized identifier for the Syr identity
protocol.

It provides:

- self-sovereign, key-anchored identity
- provider portability via registry resolution
- compatibility with institutional attestations
- traceability for OAuth actions

This document specifies:

- DID syntax
- resolution algorithm
- DID document structure
- update and migration semantics
- security requirements

---

## 2. DID Syntax

### 2.1 Method name

```
did:syr
```

---

### 2.2 Method-specific identifier

```
did:syr:<id>
```

Where:

- `<id>` is the **multibase-encoded Ed25519 public key** of the **genesis** root identity key.
- Encoding MUST use **base58btc multibase**.
- The identifier is fixed at creation and **never changes**; the *current* root key may differ from the genesis key after [root key rotation](/architecture/recovery-rotation).

Example:

```
did:syr:z6Mkt9…abc
```

---

## 3. Root Identity Binding

The DID is **cryptographically bound** to:

- the **genesis** Ed25519 public key embedded in the identifier, and
- the identity's **rotation chain**: an append-only sequence of statements, each signed by the retiring key, that advances the root from the genesis key to the **current key** (see [Root key rotation](/architecture/recovery-rotation)).

Therefore:

- No external registry is required to verify **ownership** — the genesis key anchors the chain, and the chain proves every key transition.
- Registries are used only for **service discovery**.
- Verifiers MUST anchor root-signature checks on the **current** key (genesis + chain), never on the raw genesis key alone.

---

## 4. DID Resolution

### 4.1 Resolution output

Resolving a `did:syr` MUST return a **DID Document**.

---

### 4.2 Resolution steps

Given:

```
did:syr:<publicKey>
```

Resolver MUST:

1. Decode multibase → obtain the **genesis** Ed25519 public key.
2. Obtain the identity's **rotation chain** (from the hosting record's `rotation_chain`, the provider's `GET /api/identity/{did}/rotations` endpoint, or the per-identity manifest's `endpoints.rotations`).
3. **Verify the chain** from the genesis key (link, seq continuity, per-hop signatures) → derive the **current root key**. An empty/absent chain resolves to the genesis key.
4. Query a Syr **registry** for the latest hosting record and verify its signature under the **current** key.
5. Construct the DID Document using:
   - the current root key
   - registry-discovered services.

```mermaid
sequenceDiagram
    participant Client
    participant Resolver
    participant Registry

    Client->>Resolver: Resolve did:syr:z6Mkt9...
    Resolver->>Resolver: Decode multibase -> genesis Ed25519 key
    Resolver->>Registry: GET /resolve/did:syr:z6Mkt9...
    Registry-->>Resolver: { provider: "https://...", signature: "...", rotation_chain?: [...] }
    Resolver->>Resolver: Verify rotation chain from genesis -> current key
    Resolver->>Resolver: Verify record signature with CURRENT key
    Resolver->>Resolver: Build DID Document (#root = current key)
    Resolver-->>Client: DID Document { id, verificationMethod, service }
```

---

## 5. DID Document Structure

A resolved document MUST contain:

```json
{
	"id": "did:syr:...",
	"verificationMethod": [
		{
			"id": "#root",
			"type": "Ed25519VerificationKey2020",
			"controller": "did:syr:...",
			"publicKeyMultibase": "z..."
		}
	],
	"authentication": ["#root"],
	"assertionMethod": ["#root"],
	"service": [
		{
			"id": "#provider",
			"type": "SyrIdentityProvider",
			"serviceEndpoint": "https://provider.example"
		}
	]
}
```

`#root` MUST present the **current** root key — for rotated identities this is the last `newRoot` in the rotation chain, not the genesis key encoded in the DID.

---

## 6. Registry Interaction

### 6.1 Purpose

Registry maps:

```
did:syr → current provider endpoint
```

---

### 6.2 Update authorization

Registry updates MUST:

- include a payload signed by the **root private key**
- be rejected if signature verification fails.

Registry operators:

- **cannot impersonate identities**
- **cannot forge migrations**

---

### 6.3 Minimal hosting record

```json
{
	"did": "did:syr:...",
	"provider": "https://example.org",
	"updatedAt": "...",
	"signature": "..."
}
```

---

## 7. Migration Semantics

Migration occurs when:

- root identity signs a new hosting record
- registry accepts update
- future resolutions return new provider.

Migration MUST NOT:

- change DID identifier
- invalidate past signatures
- break attestations.

---

## 8. Key Rotation

Root key rotation is supported via a **signed key update chain**: the DID stays genesis-derived and immutable while rotation statements (each signed by the retiring key) advance the current root. Resolution is always **genesis from the DID + rotation chain → current key**.

See the [Root Key Rotation Specification](/architecture/recovery-rotation) for the statement format, validation rules, and API flows.

Not supported (future work): recovery mechanisms for lost keys, multi-sig guardians.

---

## 9. Security Model

### 9.1 Trust anchor

**Only the root private key** controls:

- identity ownership
- provider migration
- authentication signatures.

---

### 9.2 Registry compromise

If registry is compromised:

- attacker cannot forge signatures
- attacker may censor or delay resolution only.

Mitigations are future work.

---

### 9.3 Provider compromise

If provider is compromised:

- attacker cannot move identity
- cannot sign as root identity.

---

## 10. OAuth Binding

When used with OAuth:

- `sub` MUST equal the **did:syr identifier**.
- Providers MUST NOT substitute usernames or database IDs.

This guarantees **portable accountability**.

---

## 11. Privacy Considerations

Because DID embeds a public key:

- identity is globally correlatable.
- pairwise or blinded identifiers are future work.

---

## 12. Versioning

**Version:** v0.1  
**Status:** Draft  
**Scope:** Minimal viable DID method for Syr identity portability.
