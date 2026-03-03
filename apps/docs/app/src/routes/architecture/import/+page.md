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
5. Client displays QR code and deeplink (`syr://export?challenge=...&instance=...`)
6. Client opens SSE to `GET /api/identity/import-heartbeat?challenge_id=...`
7. User scans QR with Syner, selects persona, signs challenge
8. Syner POSTs to `POST /api/identity/export-verify` with challenge_id, did, signature
9. Server verifies signature, creates import_token, notifies SSE subscribers
10. Client receives import_token, POSTs `POST /api/identity/import` with bundle + import_token
11. Server verifies token, creates identity as external (no Aegis), imports profile, posts, assets
12. Keys remain in Syner (self-custody)

**Requirements:** Syner app, persona matching bundle DID, network access.

---

## 4. API Summary

| Endpoint                         | Method | Auth | Purpose                                                    |
| -------------------------------- | ------ | ---- | ---------------------------------------------------------- |
| `/api/identity/import`           | POST   | Yes  | Import bundle; body: bundle + aegisBundle OR import_token  |
| `/api/identity/import-challenge` | POST   | Yes  | Create import challenge (body: `{"did"}`)                  |
| `/api/identity/import-heartbeat` | GET    | —    | SSE; receive import_token when Syner verifies              |
| `/api/identity/export-verify`    | POST   | No   | Syner calls to verify; issues export_token or import_token |

---

## 5. Related

- [Export Formats](/architecture/export) — full vs data-only .syr variants
- [Sigil](/architecture/sigil) — cryptographic format for portable keys
- [Independent Login](/architecture/independent-login) — challenge-sign flow for Syner users
