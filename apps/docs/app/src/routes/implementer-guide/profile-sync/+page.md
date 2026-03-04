---
title: Profile Sync API
---

# Profile Sync API

Profile sync allows Syner to push profile data (display name, bio, avatar, banner) to a SYR instance. The user proves key control by signing a payload; the server verifies and updates the profile.

---

## Endpoint

**POST** `/api/auth/independent-login/profile-sync`

**Content-Type:** `multipart/form-data`

---

## Request Fields

| Field            | Required | Type   | Description                                             |
| ---------------- | -------- | ------ | ------------------------------------------------------- |
| `did`            | Yes      | string | User DID                                                |
| `signature`      | Yes      | string | Multibase-encoded Ed25519 signature of `signed_payload` |
| `signed_payload` | Yes      | string | JCS canonical JSON string that was signed               |
| `display_name`   | No       | string | Display name (max 100 chars)                            |
| `bio`            | No       | string | Bio (max 500 chars)                                     |
| `avatar`         | No       | file   | Avatar image                                            |
| `banner`         | No       | file   | Banner image                                            |

---

## Signed Payload Format

The payload must be JCS canonical JSON (RFC 8785). Structure:

```json
{
	"action": "profile-sync",
	"did": "did:syr:z6Mk...",
	"issued_at": "2026-03-01T12:00:00.000Z",
	"display_name": "Alice",
	"bio": "Optional bio text"
}
```

| Field          | Required | Description                                                                    |
| -------------- | -------- | ------------------------------------------------------------------------------ |
| `action`       | Yes      | Must be `"profile-sync"`                                                       |
| `did`          | Yes      | User DID                                                                       |
| `issued_at`    | Yes      | ISO-8601 timestamp. Replay protection: server rejects if older than 5 minutes. |
| `display_name` | No       | Max 100 characters                                                             |
| `bio`          | No       | Max 500 characters                                                             |

---

## Signing

1. Build the payload object with `action`, `did`, `issued_at`, and optional `display_name`, `bio`.
2. Canonicalize with JCS (RFC 8785) to produce the string to sign.
3. Sign the UTF-8 bytes of that string with the persona's Ed25519 private key.
4. Encode the signature as multibase (base58btc).
5. POST with `did`, `signature`, `signed_payload`, and any profile fields (including avatar/banner files).

---

## Response

- **200**: Profile updated.
- **4xx/5xx**: Structured errors with `code` (machine-readable) and `message` (human-readable). The profile-sync handler uses this contract.

**Error example:**

```json
{
	"code": "VALIDATION_ERROR",
	"message": "Profile sync requires did"
}
```

---

## Reference

- Schema: `ProfileSyncSignedPayloadSchema` in `packages/ts/types/src/independent-login.ts`
- Implementation: `apps/syr/app/src/routes/api/auth/independent-login/profile-sync/+server.ts`
- Syner client: `apps/syner/app/src/lib/sync-profile.ts`
