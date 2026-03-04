---
title: syr:// Scheme and QR Exchange
---

# syr:// Scheme and QR Exchange

All SYR-compatible flows use the `syr://` custom URL scheme for deep links. Web apps display these URLs as QR codes; Syner (or compatible key-holder apps) scan and handle them.

---

## URL Patterns

| Action        | Host           | URL Pattern                                  | Params                    | Use                           |
| ------------- | -------------- | -------------------------------------------- | ------------------------- | ----------------------------- |
| Login         | `login`        | `syr://login?challenge=&instance=&callback=` | All required              | Independent login             |
| Export/Import | `export`       | `syr://export?challenge=&instance=&did=`     | `did` optional for import | Export or import verification |
| Sync Profile  | `sync-profile` | `syr://sync-profile?instance=&did=`          | Both required             | Profile sync from Syner       |

---

## Validation Rules

Implementations must validate URLs before use:

- **Scheme**: `https` always allowed; `http` only for localhost and RFC 1918 addresses (`127.x`, `10.x`, `192.168.x`, `172.16-31.x`).
- **Login**: `callback` origin must match `instance` origin (prevents open redirects).
- **Instance**: Must be a valid origin (scheme + host + port); no path or query.

Reference: [syr-url.ts](https://github.com/syr-is/syr/blob/main/apps/syner/app/src/lib/utils/syr-url.ts)

---

## Login (`syr://login`)

**Params:**

| Param       | Required | Description                                                                                 |
| ----------- | -------- | ------------------------------------------------------------------------------------------- |
| `challenge` | Yes      | Challenge ID from `POST /api/auth/independent-login/challenge`                              |
| `instance`  | Yes      | SYR instance base URL (must be URL-encoded)                                                 |
| `callback`  | Yes      | Callback URL for redirect after verification (must be URL-encoded, same origin as instance) |

**Example:**

```text
syr://login?challenge=550e8400-e29b-41d4-a716-446655440000&instance=https%3A%2F%2Fmy.syr.app&callback=https%3A%2F%2Fmy.syr.app%2Fauth%2Findependent-callback
```

**Syner routing:** Deep link routes to `/scan-confirm`, which redirects to `/independent-login` with query params.

---

## Export / Import (`syr://export`)

**Params:**

| Param       | Required | Description                                                                 |
| ----------- | -------- | --------------------------------------------------------------------------- |
| `challenge` | Yes      | Challenge ID from export or import challenge API                            |
| `instance`  | Yes      | SYR instance base URL (must be URL-encoded)                                 |
| `did`       | No       | User DID (required for export; optional for import — Syner selects persona) |

**Example (export):**

```text
syr://export?challenge=550e8400-e29b-41d4-a716-446655440000&instance=https%3A%2F%2Fmy.syr.app&did=did%3Asyr%3Az6Mk...
```

**Syner routing:** Deep link routes to `/export-verify`.

---

## Sync Profile (`syr://sync-profile`)

**Params:**

| Param      | Required | Description                                 |
| ---------- | -------- | ------------------------------------------- |
| `instance` | Yes      | SYR instance base URL (must be URL-encoded) |
| `did`      | Yes      | User DID                                    |

**Example:**

```text
syr://sync-profile?instance=https%3A%2F%2Fmy.syr.app&did=did%3Asyr%3Az6Mk...
```

**Syner routing:** Deep link routes to `/sync-profile`.

---

## QR Generation

- Use the `deeplink_url` returned by challenge APIs; no custom encoding needed.
- Typical length: 200–500 characters, fits in a single QR code (alphanumeric mode).
- Encode all query params with `encodeURIComponent()`.
