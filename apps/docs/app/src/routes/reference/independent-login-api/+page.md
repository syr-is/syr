---
title: Independent Login API
---

# Independent Login API Reference

API contract for the challenge-sign-verify independent login flow.

---

## POST /api/auth/independent-login/challenge

Creates a challenge for Syner/external key login.

**Request**

```json
{
	"origin": "https://my.syr.app"
}
```

| Field  | Type   | Description                       |
| ------ | ------ | --------------------------------- |
| origin | string | URL origin of the requesting page |

**Response (200)**

```json
{
	"challenge_id": "uuid",
	"message": "{\"domain\":\"my.syr.app\",\"nonce\":\"...\",\"action\":\"login\",\"issued_at\":\"...\",\"expires_at\":\"...\"}",
	"deeplink_url": "syr://login?challenge=...&instance=...&callback=...",
	"expires_in": 120
}
```

**Errors**

| Status | Error           | Description                    |
| ------ | --------------- | ------------------------------ |
| 403    | invalid_origin  | Origin does not match instance |
| 400    | invalid_request | Invalid challenge request      |
| 500    | server_error    | Unexpected error               |

---

## GET /api/auth/independent-login/challenge/:id

Public endpoint for Syner to fetch challenge details. No authentication.

**Response (200)**

```json
{
	"message": "...",
	"domain": "my.syr.app",
	"expires_at": "2026-03-01T12:02:00.000Z"
}
```

**Errors**

| Status | Error             | Description                 |
| ------ | ----------------- | --------------------------- |
| 410    | challenge_expired | Challenge not found/expired |

---

## POST /api/auth/independent-login/verify

Verifies the signature, creates or finds user, and returns a one-time callback token.

**Request**

```json
{
	"challenge_id": "uuid",
	"did": "did:syr:z6Mk...",
	"signature": "z...",
	"invite_code": "optional-future"
}
```

| Field        | Type   | Description                           |
| ------------ | ------ | ------------------------------------- |
| challenge_id | string | Challenge ID from challenge response  |
| did          | string | User's DID (proves key via signature) |
| signature    | string | Multibase-encoded Ed25519 signature   |
| invite_code  | string | Optional, for future invite-only mode |

**Response (200)**

```json
{
	"success": true,
	"callback_token": "uuid"
}
```

**Errors**

| Status | Error             | Description                    |
| ------ | ----------------- | ------------------------------ |
| 410    | challenge_expired | Challenge not found or expired |
| 403    | invalid_signature | Signature verification failed  |
| 400    | invalid_request   | Invalid verify request         |
| 500    | server_error      | Unexpected error               |

---

## GET /auth/independent-callback

Page that exchanges the one-time token for a session cookie and redirects to `/`.

**Query**

| Param | Description                                  |
| ----- | -------------------------------------------- |
| token | One-time callback token from verify response |

**Behavior**

- Valid token → set session cookie, redirect to `/`
- Invalid/expired → redirect to `/login?error=expired`
