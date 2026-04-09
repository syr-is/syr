---
title: GIF Store (v1 specification)
---

# GIF Store (v1 specification)

## 1. Purpose and phase alignment

This document specifies a **self-hosted GIF library** for Syr instances. GIFs are stored in the instance's SeaweedFS storage and are browsable, searchable, and usable in **comments**, **posts**, and **reactions** without relying on any external service (Tenor, Giphy, etc.).

Self-hosting GIFs preserves the **self-sovereign** principle: no third-party API calls leave the instance when a user picks a GIF. GIFs uploaded to an instance are discoverable cross-instance via public APIs.

**Related specs**

- [Emoji & Sticker Store](/architecture/emoji-sticker-store) -- custom emojis and stickers, complementary media assets.
- [Comments & Reactions](/architecture/comments-reactions) -- GIF usage in comments and as reaction media.
- [Untrusted post content](/architecture/untrusted-post-content) -- sanitization rules for GIF URLs in rendered content.

---

## 2. Goals and non-goals

### 2.1 Goals

- **Self-hosted**: All GIFs stored in the instance's SeaweedFS bucket. Zero external API dependencies.
- **Two scopes**: Instance GIF library (admin-managed, shared) and user GIF uploads (personal, counts toward storage quota).
- **Tagging and search**: GIFs are tagged with keywords for search. Tags are free-form, space-separated.
- **GIF picker UI**: Inline picker component (similar to Discord/Slack GIF picker) for selecting GIFs when composing comments, posts, or reactions.
- **Cross-instance browsing**: Public API exposes the instance GIF library so viewers on other instances can browse GIFs from the author's instance.
- **Thumbnails**: Static thumbnail (first frame or poster) generated or provided at upload time for efficient grid display.

### 2.2 Non-goals (v1)

- GIF transcoding, compression, or format conversion (WebM, MP4).
- Federation of GIF libraries across instances (manual upload only).
- AI-powered GIF search or recommendation.
- GIF creation/editing tools within the app.

---

## 3. Data model

### 3.1 GIF entry

```
Gif {
  id: RecordId (gif:{ created_by: did, id: ulid })   // composite ID for all GIFs (portable, zero-conflict)
  title: string                    // display title
  tags: string[]                   // search keywords, lowercase
  image_url: string                // URL to the GIF (SeaweedFS)
  image_key: string                // S3 object key
  thumbnail_url?: string           // static first-frame thumbnail URL
  thumbnail_key?: string           // S3 key for thumbnail
  width: number                    // intrinsic width in pixels
  height: number                   // intrinsic height in pixels
  file_size: number                // bytes
  mime_type: string                // image/gif (or image/webp for animated webp)
  scope: 'instance' | 'user'      // who owns it
  author_id: RecordId              // user who uploaded
  created_at, updated_at
}
```

### 3.2 Storage layout

**Instance GIFs:**

```text
gifs/instance/{ulid}.gif
gifs/instance/thumbs/{ulid}.webp
```

Stored under a dedicated prefix, admin-managed. Not under any user's DID namespace.

**User GIFs:**

```text
uploads/{did}/gifs/{ulid}.gif
uploads/{did}/gifs/thumbs/{ulid}.webp
```

Under the user's DID-namespaced storage. Counts toward the user's storage quota.

---

## 4. Public API

### 4.1 Instance GIF library

```
GET /api/public/gifs?search={query}&page={n}&size={n}
```

Returns the instance GIF library (all instance-scope GIFs), paginated. Search filters by tag match. No authentication required.

```json
{
	"data": [
		{
			"id": "...",
			"title": "Thumbs Up",
			"tags": ["thumbs", "up", "approve"],
			"url": "https://...",
			"thumbnail_url": "https://...",
			"width": 320,
			"height": 240
		}
	],
	"pagination": { "limit": 20, "offset": 0, "total": 150, "has_more": true }
}
```

### 4.2 User GIF library

```
GET /api/public/gifs/{did}?search={query}&page={n}&size={n}
```

Returns personal GIFs for a specific DID. No authentication required.

### 4.3 Authenticated management

```
GET    /api/gifs                      -- list user's personal GIFs
POST   /api/gifs                      -- upload a new personal GIF
DELETE /api/gifs/[did]/[id]           -- delete a personal GIF
GET    /api/admin/gifs                -- list instance GIF library (admin)
POST   /api/admin/gifs                -- upload to instance library (admin)
DELETE /api/admin/gifs/[did]/[id]     -- delete from instance library (admin)
```

---

## 5. Storage and quotas

GIF uploads use the **existing upload storage system**. User GIFs count toward the user's file storage quota -- no separate GIF-specific limits. As long as the upload fits within the user's remaining storage allocation, it is accepted.

Instance GIFs (admin library) use a **dedicated instance media storage reservation** that is separate from any admin user's personal quota. The reservation size is configured by the admin via the **Settings > Instance Config** panel (e.g., "Instance media storage budget"). This budget is drawn from the overall instance storage capacity but does not count against any individual user's allocation.

Allowed MIME types: `image/gif`, `image/webp` (animated).

---

## 6. GIF picker component

The GIF picker is a **shared UI component** embedded in comment composers, post editors, and reaction pickers.

### 6.1 Layout

- **Search bar** at top with debounced query.
- **Grid of thumbnails** below (masonry or fixed-height rows).
- **Tabs**: "Instance" (default), "My GIFs", "Upload".
- Clicking a thumbnail inserts the GIF into the current context (comment, post, or reaction).

### 6.2 Insertion formats

- **In comments/posts (markdown)**: Inserts as `![title](gif_url)` markdown image syntax.
- **As a reaction**: Stores the GIF URL as the reaction's `image_url`.

---

## 7. Cross-instance flow

When a viewer on instance A sees a comment from instance B that contains a GIF URL:

1. The GIF URL points to instance B's SeaweedFS (or its CDN).
2. If the GIF is in a `public` path, it loads directly.
3. Content trust rules apply: the viewer's instance may require consent before loading remote media.

The GIF picker for **composing** always uses the **local** instance's GIF library and the user's personal GIFs. Remote instance GIF browsing is not supported in v1 (only viewing GIFs already embedded in content).

---

## 8. Admin management

Admins can:

- Upload GIFs to the instance library via the admin panel (Settings > Instance Config or a dedicated GIF management page).
- Bulk-tag GIFs.
- Delete GIFs from the instance library.
- Configure the instance media storage reservation size.

Instance GIF storage does **not** count toward any individual user's quota; it draws from the dedicated instance media storage reservation configured in the Instance Config panel.
