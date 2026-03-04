---
title: Export Formats and Data Structures
---

# Export Formats and Data Structures

This page documents the export formats and APIs for implementers. See also [Export Formats (Architecture)](/architecture/export) for the user-facing overview.

---

## .syr (ZIP)

Full or data-only identity backup. Two variants: **full** (includes `identity.sigil`) and **data-only** (no Sigil; keys stay in Syner).

### Structure

| Path | Description |
|------|-------------|
| `manifest.json` | Export metadata: `version`, `did`, `exportedAt`, `postCount`, `assetCount` |
| `identity.json` | `IdentityExportBundle`: `did`, `publicKey`, `profile`, `delegatedKeys` |
| `identity.sigil` | Optional. Encrypted seed (PIEF v1); present for full backup, absent for data-only |
| `posts.json` | All posts |
| `assets.json` | Asset manifest |
| `pinned_posts.json` | Pinned post IDs |
| `assets/` | Binary assets (images, etc.) |

### API

- **GET** `/api/identity/export-bundle-data` — Requires session auth.
- **POST** `/api/identity/export-bundle-data` — Requires `export_token` (from [export verification](/implementer-guide/challenge-sign-flows)).

### Filename pattern

`syr-export-{didShort}-{timestamp}.syr`

---

## .sigil (PIEF v1 JSON)

Minimal portable identity export. Single JSON file containing the encrypted 32-byte Ed25519 seed.

### Structure

See [Sigil v1 spec](/architecture/sigil):

```json
{
  "v": 1,
  "kdf": {
    "name": "argon2id",
    "salt": "<base64url>",
    "mem": 65536,
    "it": 3,
    "par": 1
  },
  "enc": {
    "name": "aes-256-gcm",
    "nonce": "<base64url>",
    "ct": "<base64url>",
    "tag": "<base64url>"
  },
  "pub": "<multibase-ed25519-public-key>"
}
```

- **KDF**: Argon2id (mem 64 MiB, it 3, par 1)
- **Encryption**: AES-256-GCM

### Implementation

- `packages/rust/syr-crypto-sigil`
- `packages/ts/crypto` (createSigil, decryptSigil)
- Export-key-dialog produces `.sigil` files via SYR web app

### Filename pattern

`syr-sigil-{didShort}-{timestamp}.sigil`

---

## .persona (ZIP, Syner-compatible)

Syner-readable profile export. Used to import identity into Syner desktop app.

### Structure

```
{personaId}/
  identity.sigil   # Encrypted seed (PIEF v1)
  profile.json     # Syner Persona format
  avatar.png       # Optional
  banner.png       # Optional
```

### profile.json schema

```json
{
  "id": "<persona_id>",
  "did": "<did>",
  "publicKey": "<base64>",
  "displayName": "<string>",
  "bio": "<string>",
  "avatarUrl": "./avatar.png",
  "bannerUrl": "./banner.png",
  "createdAt": "<ISO8601>"
}
```

Fields use camelCase for Syner compatibility.

### API

- **GET** `/api/identity/export-persona-data` — Requires session auth. Returns identity, avatar, banner (base64).

### Filename pattern

`syr-persona-{didShort}-{timestamp}.persona`
