---
title: Identity Import
---

# Identity Import

SYR supports importing identity from exported backups. Two import paths exist, depending on whether the backup includes keys (Sigil) or not.

---

## 1. Overview

| Backup type            | identity.sigil | Import path           | Keys after import  |
| ---------------------- | -------------- | --------------------- | ------------------ |
| Full .syr (with Sigil) | Present        | Passphrase + password | Stored server-side |
| Data-only .syr         | Absent         | Verify with Syner     | Stay in Syner      |

---

## 2. Import from Full .syr (with Sigil)

When the backup includes `identity.sigil`, the user has a complete backup with keys.

**Flow:**

1. User selects `.syr` file in SYR's Import identity dialog
2. Client parses the zip and detects `identity.sigil`
3. User enters export passphrase and new account password
4. Client decrypts Sigil, creates Aegis bundle with new password
5. Client uploads bundle + aegisBundle to `POST /api/identity/import`
6. Server validates (DID match, key match), creates identity with Aegis, imports profile, posts, assets
7. Keys are stored server-side (custodial)

**Requirements:** Export passphrase (min 10 chars), new account password (min 8 chars).

---

## 3. Import from Data-only .syr (without Sigil)

When the backup has no `identity.sigil`, it contains profile, posts, and assets only. Keys remain in Syner.

**Flow:**

1. User selects `.syr` file in SYR's Import identity dialog
2. Client parses the zip and detects no `identity.sigil`
3. User clicks "Verify with Syner"
4. Client creates import challenge (`POST /api/identity/import-challenge` with `{"did"}` from identity.json)
5. Client displays QR code and deeplink (`syr://import?challenge=...&instance=...`)
6. Client opens SSE to `GET /api/identity/import-heartbeat?challenge_id=...`
7. User scans QR with Syner, selects persona, signs challenge
8. Syner POSTs to `POST /api/identity/export-verify` with challenge_id, did, signature
9. Server verifies signature, creates import_token, notifies SSE subscribers
10. Client receives import_token, POSTs `POST /api/identity/import` with bundle + import_token
11. Server verifies token, creates identity as external (no Aegis), imports profile, posts, assets
12. Keys remain in Syner (self-custody)

**Requirements:** Syner app, persona matching bundle DID, network access.

---

## 4. Bundle authenticity verification (manifest v2)

A `.syr` bundle carries a [manifest v2](/architecture/export). Before any import, the bundle is classified into one of three trust states. The **import dialog** classifies client-side for immediate feedback, and the **server re-verifies from the raw zip bytes on `POST /api/identity/import`** — the server is always the authority; a tampered bundle can never be imported by trusting the client.

### Trust states

| State             | Bundle                                     | UI                                                    | Import        |
| ----------------- | ------------------------------------------ | ----------------------------------------------------- | ------------- |
| `verified`        | v2 signed, all checks pass                 | Green "Verified backup" badge                         | Allowed       |
| `legacy_unsigned` | v1 manifest, or v2 with `"unsigned": true` | Amber "Legacy unsigned — authenticity not verifiable" | Allowed       |
| `tampered`        | v2 **signed** bundle that failed any check | Red "Tampered backup — import blocked"                | **Hard-fail** |

Legacy (v1) and explicitly-unsigned (v2) bundles remain importable — their authenticity simply cannot be established, and the UI says so. There is **no flag** that lets a tampered v2 signed bundle through.

### Verification pipeline (v2 signed bundles)

1. **Recompute every file hash.** Each `manifest.files` entry must exist in the zip and its SHA-256 must match. Then every zip entry except `manifest.json` must appear in `manifest.files` (no injected files).
2. **Verify the rotation chain** embedded in `identity.json` (`rotationChain`) from the DID-derived genesis key via `verifyRotationChain(did, chain)`, yielding the current root key.
3. **Bind the signing key.** `manifest.signature.signing_key` must equal that chain-resolved current root.
4. **Re-canonicalize** the manifest (sans its signature block) and byte-compare against `signature.signed_payload_json`.
5. **Verify the Ed25519 signature** over `signed_payload_json` under the current root.

Any failure yields `tampered` with a precise sub-code; the server maps it to **HTTP 422 `IMPORT_TAMPERED`** and performs no writes.

### Error sub-codes

| Sub-code                | Meaning                                              |
| ----------------------- | ---------------------------------------------------- |
| `MANIFEST_INVALID`      | v2 manifest failed schema validation                 |
| `MANIFEST_DID_MISMATCH` | `manifest.did` ≠ `identity.json` DID                 |
| `FILE_MISSING`          | A hashed file is absent from the bundle              |
| `FILE_HASH_MISMATCH`    | A file's SHA-256 does not match the manifest         |
| `EXTRA_FILE`            | A zip entry is not covered by the signed manifest    |
| `CHAIN_INVALID`         | The embedded rotation chain failed verification      |
| `SIGNING_KEY_INVALID`   | `signing_key` is malformed                           |
| `SIGNING_KEY_MISMATCH`  | `signing_key` is not the chain-resolved current root |
| `CANONICAL_MISMATCH`    | Manifest content diverges from its signed payload    |
| `SIGNATURE_INVALID`     | Malformed signature or Ed25519 verification failed   |

---

## 5. API Summary

| Endpoint                         | Method | Auth | Purpose                                                    |
| -------------------------------- | ------ | ---- | ---------------------------------------------------------- |
| `/api/identity/import`           | POST   | Yes  | Import bundle; body: bundle + aegisBundle OR import_token  |
| `/api/identity/import-challenge` | POST   | Yes  | Create import challenge (body: `{"did"}`)                  |
| `/api/identity/import-heartbeat` | GET    | —    | SSE; receive import_token when Syner verifies              |
| `/api/identity/export-verify`    | POST   | No   | Syner calls to verify; issues export_token or import_token |

On `POST /api/identity/import`, a tampered v2 signed bundle is rejected with **HTTP 422** and code `IMPORT_TAMPERED` before any identity/profile/post/asset write.

---

## 6. Related

- [Export Formats](/architecture/export) — full vs data-only .syr variants
- [Sigil](/architecture/sigil) — cryptographic format for portable keys
- [Independent Login](/architecture/independent-login) — challenge-sign flow for Syner users
