---
title: syr:// Scheme and QR Exchange
---

# syr:// Scheme and QR Exchange

All SYR-compatible flows use the `syr://` custom URL scheme for deep links. Web apps display these URLs as QR codes; Syner (or compatible key-holder apps) scan and handle them.

---

## URL Patterns

| Action         | Host             | URL Pattern                                      | Params         | Use                           |
| -------------- | ---------------- | ------------------------------------------------ | -------------- | ----------------------------- |
| Login          | `login`          | `syr://login?challenge=&instance=&callback=`     | All required   | Independent login             |
| Export         | `export`         | `syr://export?challenge=&instance=&did=`         | `did` required | Export verification           |
| Import         | `import`         | `syr://import?challenge=&instance=&did=`         | `did` optional | Import/migration verification |
| Delete Aegis   | `delete-aegis`   | `syr://delete-aegis?challenge=&instance=&did=`   | All required   | Remove Aegis (prove backup)   |
| Delete Account | `delete-account` | `syr://delete-account?challenge=&instance=&did=` | All required   | Permanently delete account    |
| Sync Profile   | `sync-profile`   | `syr://sync-profile?instance=&did=`              | Both required  | Profile sync from Syner       |

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

## Export (`syr://export`)

**Params:**

| Param       | Required | Description                                 |
| ----------- | -------- | ------------------------------------------- |
| `challenge` | Yes      | Challenge ID from export challenge API      |
| `instance`  | Yes      | SYR instance base URL (must be URL-encoded) |
| `did`       | Yes      | User DID                                    |

**Example:**

```text
syr://export?challenge=550e8400-e29b-41d4-a716-446655440000&instance=https%3A%2F%2Fmy.syr.app&did=did%3Asyr%3Az6Mk...
```

**Syner routing:** Deep link routes to `/export-verify`.

---

## Import (`syr://import`)

**Params:**

| Param       | Required | Description                                 |
| ----------- | -------- | ------------------------------------------- |
| `challenge` | Yes      | Challenge ID from import challenge API      |
| `instance`  | Yes      | SYR instance base URL (must be URL-encoded) |
| `did`       | No       | User DID (optional — Syner selects persona) |

**Example:**

```text
syr://import?challenge=550e8400-e29b-41d4-a716-446655440000&instance=https%3A%2F%2Fmy.syr.app&did=did%3Asyr%3Az6Mk...
```

**Syner routing:** Deep link routes to `/export-verify`.

---

## Delete Aegis (`syr://delete-aegis`)

**Params:**

| Param       | Required | Description                                  |
| ----------- | -------- | -------------------------------------------- |
| `challenge` | Yes      | Challenge ID from delete-aegis challenge API |
| `instance`  | Yes      | SYR instance base URL (must be URL-encoded)  |
| `did`       | Yes      | User DID                                     |

**Syner routing:** Deep link routes to `/export-verify`.

---

## Delete Account (`syr://delete-account`)

**Params:**

| Param       | Required | Description                                 |
| ----------- | -------- | ------------------------------------------- |
| `challenge` | Yes      | Challenge ID from delete-challenge API      |
| `instance`  | Yes      | SYR instance base URL (must be URL-encoded) |
| `did`       | Yes      | User DID                                    |

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
