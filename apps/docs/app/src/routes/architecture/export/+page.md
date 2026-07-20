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
manifest.json      # Manifest v2 — signed, self-verifying (see §5)
identity.json      # IdentityExportBundle (did, publicKey, profile, delegatedKeys, rotationChain)
identity.sigil     # Encrypted seed (PIEF v1)
posts.json         # All posts
assets.json        # Asset manifest
pinned_posts.json # Pinned post IDs
assets/            # Binary assets (images, etc.)
```

**Data-only .syr** includes the same except **identity.sigil** is omitted. Independent users (keys managed in Syner) verify via Syner challenge-sign flow; no Sigil is produced.

`identity.json` embeds the full **rotation chain** (`rotationChain`) so the bundle is self-verifying: an importer resolves the current root key with `verifyRotationChain(did, chain)` without access to the exporting instance's `identity_rotation` table.

**Filename pattern:** `syr-export-{didShort}-{timestamp}.syr`

**Use case:** Complete backup (full) or profile/data backup (data-only). Reclaim identity in SYR web app.

**Import:** Use SYR's [Import identity](/architecture/import) dialog. For full .syr: export passphrase and new account password. For data-only: verify with Syner.

---

## 5. Manifest v2 — signed, self-verifying bundle

Every `.syr` bundle carries a `manifest.json` with `format_version: 2`. The manifest hashes every file in the bundle and, for custodial/device-signed exports, binds those hashes with an Ed25519 signature made by the **root key** — turning the bundle into a tamper-evident, self-verifying unit.

### Shape

```json
{
	"format_version": 2,
	"did": "did:syr:z6Mk…",
	"created_at": "2026-07-20T10:00:00.000Z",
	"rotation_seq": 0, // rotation-chain length at export (0 = never rotated)
	"counts": { "posts": 12, "assets": 34, "pinned_posts": 3 },
	"files": {
		// SHA-256 (hex) of EVERY bundle file except manifest.json
		"identity.json": "<sha256>",
		"posts.json": "<sha256>",
		"assets.json": "<sha256>",
		"pinned_posts.json": "<sha256>",
		"identity.sigil": "<sha256>", // present only in full custodial bundles
		"assets/…": "<sha256>"
	},
	"signature": {
		// present for SIGNED bundles; mutually exclusive with `unsigned`
		"signed_payload_json": "<RFC 8785 JCS of the manifest sans this block>",
		"signature": "<multibase Ed25519 over signed_payload_json>",
		"signing_key": "<multibase root public key current at export>"
	}
}
```

`manifest.json` cannot hash itself, so it is the one file excluded from `files`. The signature covers the JCS canonical form of every other field — including the full `files` map — so any change to any file is detectable. `signed_payload_json` stores the exact signed bytes (mirroring the `canonical_delegation` pattern) so verifiers re-canonicalize, byte-compare, then check the signature.

### Two authenticity states (never both)

| State                   | Marker             | Produced by                           | Authenticity   |
| ----------------------- | ------------------ | ------------------------------------- | -------------- |
| **Signed**              | `signature` block  | Custodial (Aegis) full `.syr`         | Verifiable     |
| **Explicitly unsigned** | `"unsigned": true` | Self-custody (Syner) data-only `.syr` | Not verifiable |

### Signing flows

- **Custodial (Aegis) exports** — the export already gates on the account password. Inside the unlock scope the seed is decrypted, every bundle file is assembled and hashed, the manifest is signed with the seed (`signing_key = identity.publicKey`, the current root), and the seed is zeroized. Result: a **signed** manifest v2.
- **Self-custody (Syner) exports** — keys live in Syner and the existing export challenge/sign round signs each post and asset, but it cannot yet carry the final manifest payload (whose `files` hashes only exist after the browser serializes the zip) without a redesign of that round. Per the locked design's fallback, these bundles emit `format_version: 2` with an explicit **`"unsigned": true`** marker — never a silent downgrade. See [spec-mapping](/reference/spec-mapping) for the tracked gap.

`.persona` and `.sigil` formats are unchanged this phase and carry no manifest v2.

`public_hash` (per-identity content cache signal on the federation manifest) is unrelated to bundle signing: it stays a **non-authenticated cache hint** and is never a trust anchor.

---

## 6. Summary

- **Export Sigil** — Single `.sigil` file. Minimal. Key recovery.
- **Export Persona** — `.persona` zip. Syner-readable. Profile + assets.
- **Export SYR** — `.syr` zip. Full backup (with Sigil) or data-only (no Sigil). Reclaim in SYR.

**Aegis users** (keys stored server-side): Unlock with account password, set export passphrase; seed encrypted as Sigil. Export SYR includes identity.sigil.

**Independent users** (keys in Syner): Verify via Syner challenge-sign. Export SYR is data-only (no identity.sigil).

See [Import](/architecture/import) for how to restore each variant.
