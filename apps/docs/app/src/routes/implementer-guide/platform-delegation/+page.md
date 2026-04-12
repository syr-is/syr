---
title: Platform Delegation Integration Guide
---

# Platform Delegation Integration Guide

This guide covers how to integrate a consumer application with an identity provider instance using platform delegation.

**Important:** No API paths are hardcoded. All endpoints are discovered from the instance manifest at `/.well-known/syr`.

---

## Overview

1. **Discovery** — Fetch the instance manifest to learn endpoint URLs
2. **Registration** — Redirect user to the discovered consent page
3. **Token exchange** — Exchange code for a platform access token (via discovered token endpoint)
4. **Signing** — Request signatures via discovered signing endpoint
5. **Verification** — Verify signatures via discovered delegation listing endpoint

---

## 0. Endpoint Discovery

Before any operation, fetch the instance manifest. This is the **only static path** your application needs to know:

```
GET {instance_url}/.well-known/syr
Accept: application/json
```

Response includes a `platform` section with all endpoint URLs:

```json
{
	"name": "syr",
	"public_url": "https://instance.example.com",
	"platform": {
		"consent": "https://instance.example.com/auth/platform-consent",
		"token": "https://instance.example.com/api/platform/token",
		"sign": "https://instance.example.com/api/platform/sign",
		"challenge": "https://instance.example.com/api/platform/challenge",
		"delegations": "https://instance.example.com/api/platform/delegations",
		"revoke": "https://instance.example.com/api/platform/revoke"
	}
}
```

If `platform` is absent, the instance does not support platform delegation.

Cache this manifest (recommended TTL: 5 minutes). Use the discovered URLs for all subsequent steps.

---

## 1. Registration

### Collect the instance URL

Ask the user for their identity provider instance URL (e.g., `syr.example.com`). This is the **only input** required — they never enter a DID.

### Redirect to the consent page

Build the redirect URL using the discovered `platform.consent` endpoint:

```
{manifest.platform.consent}
  ?platform_origin=https://your-app.example.com
  &platform_name=Your App Name
  &callback_url=https://your-app.example.com/callback
  &scopes=identity:read,profile:read
  &state=csrf-token
```

| Parameter         | Required | Description                                                       |
| ----------------- | -------- | ----------------------------------------------------------------- |
| `platform_origin` | Yes      | Your application's origin URL                                     |
| `platform_name`   | No       | Human-readable name (defaults to hostname)                        |
| `callback_url`    | Yes      | Where the user is sent after consent                              |
| `scopes`          | No       | Comma-separated scopes (defaults to `identity:read,profile:read`) |
| `state`           | No       | CSRF token — returned unchanged on callback                       |

The identity provider will:

1. Require the user to sign in (if not already)
2. Resolve the user's DID from their session — **no DID input needed**
3. Show a consent page
4. On approval, redirect to your `callback_url`

### Handle the callback

```
https://your-app.example.com/callback?code=xxx&delegation_id=yyy&state=your-state
```

On denial:

```
https://your-app.example.com/callback?error=consent_denied&error_description=...
```

---

## 2. Token Exchange

Exchange the authorization code using the discovered `platform.token` endpoint:

```
POST {manifest.platform.token}
Content-Type: application/json

{
  "code": "authorization-code",
  "delegation_id": "delegation-id-from-callback",
  "callback_url": "https://your-app.example.com/callback",
  "platform_origin": "https://your-app.example.com"
}
```

### Response

```json
{
	"access_token": "eyJ...",
	"token_type": "Bearer",
	"expires_in": 86400,
	"did": "did:syr:z6Mk...",
	"delegate_public_key": "z6Mk...",
	"scopes": ["identity:read", "profile:read"]
}
```

Store `access_token`, `delegate_public_key`, and `did`.

### Fetch user profile

After token exchange, fetch the user's profile via their identity manifest:

```
GET {instance_url}/.well-known/syr/{did}
Accept: application/json
```

This returns the identity manifest with a `endpoints.profile` URL. Fetch that URL to get display name, avatar, bio, etc.

---

## 3. Signing Content

Request a signature using the discovered `platform.sign` endpoint:

```
POST {manifest.platform.sign}
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "payload": {
    "type": "message@v1",
    "channel_id": "general",
    "sender_id": "did:syr:z6Mk...",
    "content": "Hello, world!",
    "created_at": "2026-04-11T12:00:00Z"
  },
  "payload_type": "message@v1"
}
```

### Response

```json
{
	"signature": "z3MN...",
	"delegate_public_key": "z6Mk...",
	"did": "did:syr:z6Mk...",
	"signed_at": "2026-04-11T12:00:00.123Z"
}
```

The payload is canonicalized using JCS (RFC 8785) before signing.

---

## 4. Verifying Signatures

### Step 1: Fetch identity manifest

```
GET {signer_instance}/.well-known/syr/{signer_did}
Accept: application/json
```

### Step 2: Fetch delegation info

Use the discovered `endpoints.platform_delegations` URL:

```
GET {identity_manifest.endpoints.platform_delegations}?did={signer_did}
```

### Step 3: Check revocation

If `revoked_at` is set, the signature is **semantically invalid**.

### Step 4: Verify the signature

1. Find the delegation matching the `delegate_public_key` from the signed content.
2. Canonicalize the content payload using JCS (RFC 8785).
3. Decode the multibase signature.
4. Verify the Ed25519 signature against the delegate public key and canonical payload.

---

## 5. Re-login (Challenge-based)

Re-authenticate users using the discovered `platform.challenge` endpoint:

```
POST {manifest.platform.challenge}
Content-Type: application/json

{
  "did": "did:syr:z6Mk...",
  "platform_origin": "https://your-app.example.com",
  "challenge": "random-challenge-string"
}
```

### Response

```json
{
	"signature": "z3MN...",
	"delegate_public_key": "z6Mk...",
	"did": "did:syr:z6Mk..."
}
```

Verify the signature against your stored `delegate_public_key`. If valid, create a session.

---

## 6. Handling Revocation

If the user revokes your delegation:

- Signing requests return `403` with `delegation_revoked`
- Challenge requests also fail
- Your application SHOULD degrade gracefully (unsigned content with warning, prompt to re-authorize)

---

## 7. Error Codes

| Error                | Description                             |
| -------------------- | --------------------------------------- |
| `unknown_did`        | DID not registered on this instance     |
| `invalid_request`    | Malformed request body                  |
| `invalid_code`       | Authorization code not found or expired |
| `invalid_origin`     | Platform origin does not match          |
| `consent_denied`     | User denied the delegation request      |
| `delegation_revoked` | Platform delegation has been revoked    |
| `server_error`       | Unexpected server error                 |
