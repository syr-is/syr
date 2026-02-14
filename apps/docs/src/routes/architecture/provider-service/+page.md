---
title: Syr Provider Service Specification v0.1
---

# Syr Provider Service Specification v0.1

## 1. Purpose

A **Syr Identity Provider** is a network service responsible for hosting
the active state of a root identity, including:

- profile data
- public metadata
- OAuth endpoints
- delegated signing context (future)
- migration export/import

Providers enable identities to be:

- reachable on the network
- portable across hosts
- usable in external applications

This specification defines the **minimum required HTTP interface**
for interoperability in Syr v0.1.

---

## 2. Design Principles

### 2.1 Providers do not own identity

Providers:

- host identity state
- serve APIs
- participate in OAuth

Providers MUST NOT:

- control the root private key
- prevent migration
- impersonate the identity

---

### 2.2 Providers are replaceable

Any compliant provider must allow:

- export of identity data
- import to another provider
- uninterrupted DID continuity

---

### 2.3 Minimal viable surface

v0.1 defines only:

- public metadata endpoint
- profile retrieval
- OAuth endpoints (minimal)
- export endpoint for migration

No:

- federation
- advanced permissions
- streaming sync
- social graph APIs

---

## 3. Provider Discovery

Given a resolved registry record:

```
did:syr → https://provider.example
```

Clients MUST query:

```
GET /.well-known/syr
```

---

### 3.1 Discovery response

```json
{
	"did": "did:syr:...",
	"provider": "https://provider.example",
	"endpoints": {
		"profile": "/profile",
		"oauth_authorize": "/oauth/authorize",
		"oauth_token": "/oauth/token",
		"oauth_userinfo": "/oauth/userinfo",
		"export": "/export"
	}
}
```

Rules:

- All paths are **relative to provider origin**.
- Provider MUST ensure `did` matches served identity.

---

## 4. Profile Endpoint

### 4.1 Retrieve profile

```
GET /profile
```

Returns **public profile representation**.

Example:

```json
{
	"did": "did:syr:...",
	"displayName": "Alice",
	"bio": "...",
	"avatar": "https://...",
	"updatedAt": "..."
}
```

Requirements:

- MUST be publicly accessible.
- MUST correspond to the resolved DID.
- MUST NOT expose private data.

---

## 5. OAuth Endpoints (Minimal OIDC-Compatible)

Providers MUST implement:

| Endpoint         | Purpose               |
| ---------------- | --------------------- |
| /oauth/authorize | User authorization    |
| /oauth/token     | Code → token exchange |
| /oauth/userinfo  | Identity claims       |

---

### 5.1 OAuth Subject Rule

All tokens MUST use:

```
sub = did:syr identifier
```

Never:

- usernames
- database IDs
- provider-specific identifiers

This guarantees **cross-provider portability**.

---

### 5.2 Required UserInfo claims

```json
{
	"sub": "did:syr:...",
	"did": "did:syr:...",
	"profile": "https://provider.example/profile"
}
```

Additional claims are **optional**.

---

## 6. Migration Support

### 6.1 Export endpoint

```
GET /export
```

**Authentication:** The `/export` endpoint MUST require proof of authorization
before returning the portable identity bundle. Callers MUST present either:

- a signed assertion from the root key, or
- an authorized delegated key

**Accepted proof mechanism:** Providers MUST accept one of:

- `Authorization: Bearer <JWT>` where the JWT is signed by the root or delegated key, or
- `Authorization: Syr-Signature <base64>` with a signed HTTP Authorization header
  containing a timestamped assertion from the root or delegated key

**Failure responses:**

| Code | Meaning |
| ---- | ------- |
| 401  | Unauthorized — missing or invalid proof |
| 403  | Forbidden — insufficient delegation (e.g. key lacks export scope) |

Returns a **portable identity bundle** containing:

- profile data
- public assets metadata
- provider-specific state needed for migration

Example:

```json
{
  "did": "did:syr:...",
  "profile": { ... },
  "assets": [ ... ],
  "exportedAt": "..."
}
```

---

### 6.2 Import (out of scope for v0.1)

Import behavior is **provider-implementation specific** in v0.1,
but future specs will standardize it.

---

### 6.3 Migration invariants

Providers MUST NOT:

- refuse export
- lock identity data
- alter DID identifier
- invalidate signatures

---

## 7. Security Model

### 7.1 Root key authority

Providers MUST treat:

> root key signatures as the only authority
> for:

- registry updates
- delegated key authorization (future)
- sensitive actions

---

### 7.2 Provider compromise

If compromised:

- attacker MAY serve incorrect profile data
- attacker MUST NOT be able to:
  - migrate identity
  - forge root signatures
  - change DID

---

### 7.3 TLS requirement

Providers MUST:

- serve all endpoints over **HTTPS**
- use valid TLS certificates

Plain HTTP is **not permitted**.

---

## 8. Privacy Considerations

Public profile endpoint reveals:

- existence of identity
- chosen public metadata

Providers SHOULD:

- minimize exposed data
- avoid leaking private activity

Advanced privacy controls are **future work**.

---

## 9. Future Extensions (Not in v0.1)

Planned provider capabilities:

- delegated device keys
- signed activity streams
- federation sync
- selective disclosure
- encrypted private storage
- institutional role APIs

These are intentionally excluded from v0.1.

---

## 10. Versioning

**Version:** v0.1  
**Status:** Draft  
**Scope:** Minimum provider interface required to support:

- DID resolution
- profile hosting
- OAuth acting identity
- identity migration

Future versions will expand toward **full federated identity hosting**.
