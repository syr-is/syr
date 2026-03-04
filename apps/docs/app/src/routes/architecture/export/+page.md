---
title: Export Formats — SYR, Sigil, Persona
---

# Export Formats — SYR, Sigil, Persona

The SYR web application supports three export methods, each with a purpose-specific file extension for app association and user clarity.

The `.syr` format has two variants: **full** (includes Sigil, for Aegis users) and **data-only** (no Sigil, for independent users). See Section 4.

---

## 1. File Extensions Overview

| Extension  | Format         | Opens in | Use case                                          |
| ---------- | -------------- | -------- | ------------------------------------------------- |
| `.sigil`   | JSON (PIEF v1) | —        | Bare minimum identity; key recovery               |
| `.persona` | ZIP            | Syner    | Syner-readable profile; import into Syner desktop |
| `.syr`     | ZIP            | SYR web  | Full or data backup; reclaim identity in SYR      |

The `.sigil` and `.persona` exports always include the root identity seed encrypted as **Sigil** (PIEF v1). The `.syr` export may or may not include Sigil depending on the user's identity type. See [Sigil v1](/architecture/sigil) for the cryptographic specification.

For implementer details and API contracts, see [Implementer Guide: Export Formats](/implementer-guide/export-formats).

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

**Contents:** ZIP archive with identity backup. Two variants:

### Variants

| Variant       | identity.sigil | Source                           | Use case                                           |
| ------------- | -------------- | -------------------------------- | -------------------------------------------------- |
| **Full**      | Present        | Aegis users (password unlock)    | Complete backup; reclaim identity with keys in SYR |
| **Data-only** | Absent         | Independent users (Syner verify) | Profile, posts, assets; keys stay in Syner         |

**Full .syr** includes:

```
manifest.json      # Export metadata (version, did, exportedAt, postCount, assetCount)
identity.json      # IdentityExportBundle (did, publicKey, profile, delegatedKeys)
identity.sigil     # Encrypted seed (PIEF v1)
posts.json         # All posts
assets.json        # Asset manifest
pinned_posts.json # Pinned post IDs
assets/            # Binary assets (images, etc.)
```

**Data-only .syr** includes the same except **identity.sigil** is omitted. Independent users (keys managed in Syner) verify via Syner challenge-sign flow; no Sigil is produced.

**Filename pattern:** `syr-export-{didShort}-{timestamp}.syr`

**Use case:** Complete backup (full) or profile/data backup (data-only). Reclaim identity in SYR web app.

**Import:** Use SYR's [Import identity](/architecture/import) dialog. For full .syr: export passphrase and new account password. For data-only: verify with Syner.

---

## 5. Summary

- **Export Sigil** — Single `.sigil` file. Minimal. Key recovery.
- **Export Persona** — `.persona` zip. Syner-readable. Profile + assets.
- **Export SYR** — `.syr` zip. Full backup (with Sigil) or data-only (no Sigil). Reclaim in SYR.

**Aegis users** (keys stored server-side): Unlock with account password, set export passphrase; seed encrypted as Sigil. Export SYR includes identity.sigil.

**Independent users** (keys in Syner): Verify via Syner challenge-sign. Export SYR is data-only (no identity.sigil).

See [Import](/architecture/import) for how to restore each variant.
