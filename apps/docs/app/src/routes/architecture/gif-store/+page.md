---
title: GIF Store (v1 specification)
---

# GIF Store (v1 specification)

## 1. Purpose and phase alignment

This document specifies a **self-hosted GIF library** for Syr instances. GIFs are stored in the instance's object storage and are browsable, searchable, and usable in **comments**, **posts**, and **reactions** without relying on any external service (Tenor, Giphy, etc.).

Self-hosting GIFs preserves the **self-sovereign** principle: no third-party API calls leave the instance when a user picks a GIF. GIFs uploaded to an instance are discoverable cross-instance via public APIs.

**Related specs**

- [Emoji & Sticker Store](/architecture/emoji-sticker-store) -- custom emojis and stickers, complementary media assets.
- [Comments & Reactions](/architecture/comments-reactions) -- GIF usage in comments and as reaction media.
- [Untrusted post content](/architecture/untrusted-post-content) -- sanitization rules for GIF URLs in rendered content.

---

## 2. Goals and non-goals

### 2.1 Goals

- **Self-hosted**: All GIFs stored in the instance's object storage. Zero external API dependencies.
- **Two scopes**: Instance GIF library (admin-managed, shared) and user GIF library (personal).
- **Tagging and search**: GIFs are tagged with keywords for search. Tags are free-form, comma-separated.
- **GIF picker UI**: Inline picker component (similar to Discord/Slack GIF picker) for selecting GIFs when composing comments, posts, or reactions.
- **Cross-instance browsing**: Public API exposes instance and user GIF catalogs so viewers on other instances can browse and display GIFs.

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
  id: composite (gif:{ created_by: did, id: ulid })
  url: string                     // absolute URL to the GIF
  thumbnail_url?: string          // static thumbnail URL (first frame or poster)
  mime_type: string               // image/gif, image/webp (animated)
  size: number                    // bytes
  scope: 'instance' | 'user'     // who owns it
  tags: string[]                  // search keywords, lowercase
  created_at, updated_at
}
```

---

## 4. Public API

### 4.1 Instance GIF library

```
GET /api/public/gifs?search={query}&limit={n}&offset={n}
```

Returns the instance GIF library (all instance-scope GIFs), paginated. `search` filters by tag match. No authentication required.

```json
{
	"status": "success",
	"data": [
		{
			"did": "did:syr:z6Mk...",
			"local_id": "01ARZ3N...",
			"url": "https://...",
			"thumbnail_url": "https://...",
			"tags": ["thumbs", "up", "approve"],
			"size": 524288
		}
	],
	"pagination": { "limit": 20, "offset": 0, "total": 150, "has_more": true }
}
```

### 4.2 User GIF library

```
GET /api/public/gifs/{did}?limit={n}&offset={n}
```

Returns personal GIFs for a specific DID. No authentication required. Same response format.

---

## 5. Formats

Allowed MIME types for GIF assets: `image/gif`, `image/webp` (animated).

Storage management (quotas, limits, capacity budgeting) is an implementation concern and not defined by this specification.

---

## 6. GIF picker component

The GIF picker is a **shared UI component** embedded in comment composers, post editors, and reaction pickers.

### 6.1 Layout

- **Search bar** at top with debounced query.
- **Grid of thumbnails** (fixed-height rows).
- **Tabs**: "Instance" (default), "My GIFs".
- Clicking a thumbnail inserts the GIF into the current context (comment, post, or reaction).

### 6.2 Insertion formats

- **In comments/posts (markdown)**: Inserts as `![GIF](gif_url)` markdown image syntax.
- **As a reaction**: Creates a reaction with `kind: 'gif'` and the GIF URL as `image_url`.

---

## 7. Cross-instance flow

When a viewer on instance A sees a comment from instance B that contains a GIF URL:

1. The GIF URL points to instance B's object storage.
2. If the GIF is in a `public` path, it loads directly.
3. Content trust rules apply: the viewer's instance may require consent before loading remote media.

The GIF picker for **composing** always uses the **local** instance's GIF library and the user's personal GIFs.

### 7.1 Manifest discovery

GIF catalog endpoints are advertised in the per-identity manifest at `/.well-known/syr/{did}`:

```json
{
	"endpoints": {
		"public_gifs": "https://instance.example/api/public/gifs/did:syr:z6Mk..."
	}
}
```

And in the instance manifest at `/.well-known/syr`:

```json
{
	"api": {
		"public_gifs": "https://instance.example/api/public/gifs"
	}
}
```

Clients **must** prefer manifest-discovered URLs over hardcoded path assumptions.
