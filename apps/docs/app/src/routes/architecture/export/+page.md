---
title: Export Formats — SYR, Sigil, Persona
---

# Export Formats — SYR, Sigil, Persona

The SYR web application supports three export methods, each with a purpose-specific file extension for app association and user clarity.

---

## 1. File Extensions Overview

| Extension  | Format         | Opens in | Use case                                          |
| ---------- | -------------- | -------- | ------------------------------------------------- |
| `.sigil`   | JSON (PIEF v1) | —        | Bare minimum identity; key recovery               |
| `.persona` | ZIP            | Syner    | Syner-readable profile; import into Syner desktop |
| `.syr`     | ZIP            | SYR web  | Full backup; reclaim identity in SYR              |

All three include the root identity seed encrypted as **Sigil** (PIEF v1). See [Sigil v1](/architecture/sigil) for the cryptographic specification.

---

## 2. Export Sigil (`.sigil`)

**Contents:** Single JSON file containing the encrypted identity seed (PIEF v1).

**Filename pattern:** `syr-sigil-{didShort}-{timestamp}.sigil`

**Use case:** Bare minimum identity backup. Key recovery. Minimal footprint.

**Import:** Use the export passphrase to decrypt. Import into SYR (via full bundle flow) or Syner (via sigil import).

---

## 3. Export Persona (`.persona`)

**Contents:** ZIP archive with Syner persona folder structure:

```
{persona_id}/
  identity.sigil   # Encrypted seed (PIEF v1)
  profile.json     # Syner Persona format (displayName, bio, avatarUrl, bannerUrl)
  avatar.png       # Optional, if profile has avatar
  banner.png       # Optional, if profile has banner
```

**Filename pattern:** `syr-persona-{didShort}-{timestamp}.persona`

**profile.json format** (Syner-compatible, camelCase):

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

**Use case:** Syner-readable profile. Import into Syner desktop app. Includes identity, profile metadata, and avatar/banner assets.

**Import:** Extract the zip and place the `{persona_id}` folder into Syner's personas directory, or use Syner's import flow when `.persona` file association is supported.

---

## 4. Export SYR (`.syr`)

**Contents:** ZIP archive with full identity backup:

```
manifest.json      # Export metadata (version, did, exportedAt, postCount, assetCount)
identity.json      # IdentityExportBundle (did, publicKey, profile, delegatedKeys)
identity.sigil     # Encrypted seed (PIEF v1)
posts.json         # All posts
assets.json        # Asset manifest
pinned_posts.json # Pinned post IDs
assets/            # Binary assets (images, etc.)
```

**Filename pattern:** `syr-export-{didShort}-{timestamp}.syr`

**Use case:** Complete backup. Full migration. Reclaim identity in SYR web app.

**Import:** Use SYR's Import identity dialog. Accepts `.syr` or `.zip` files. Requires export passphrase and new account password.

---

## 5. Summary

- **Export Sigil** — Single `.sigil` file. Minimal. Key recovery.
- **Export Persona** — `.persona` zip. Syner-readable. Profile + assets.
- **Export SYR** — `.syr` zip. Full backup. Reclaim in SYR.

All exports require the user to unlock their identity (account password) and set an export passphrase. The seed is encrypted client-side as Sigil before download.
