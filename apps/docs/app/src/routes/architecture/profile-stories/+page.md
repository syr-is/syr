---
title: Profile Stories (v1 specification)
---

# Profile Stories (v1 specification)

## 1. Purpose and phase alignment

This document specifies **profile stories**: short-lived, **public** visual slides (images and short video) attached to a **`did:syr` identity**, discoverable from the **home feed** and from **profile avatars**, in an Instagram-style **horizontal tray + fullscreen viewer** pattern.

Stories are **beyond Phase 0** and build on existing **DID-scoped object storage**, **`upload` records**, and **cross-provider follows** ([Follows, Discovery, and Home Timeline](/architecture/follows-and-timeline)). This page is a **design spec**; implementation is tracked in the [spec-to-implementation map](/reference/spec-mapping).

**Related specs**

- [Follows, Discovery, and Home Timeline](/architecture/follows-and-timeline) — follow rows, `followed_provider_url`, client-side aggregation to peer providers.
- [Signed profile & post mutations](/architecture/signed-profile-post-mutations) — optional future signing for story publish events (v1 may omit).
- [Untrusted post content](/architecture/untrusted-post-content) — MIME allow-lists and size limits should align for story media.

---

## 2. Goals and non-goals

### 2.1 Goals (v1)

- **Ephemeral reel:** Only slides whose **publish time** falls within the **last 24 hours (rolling, UTC)** appear in APIs and UI.
- **UTC-organized storage:** Objects live under a **UTC calendar-date** prefix derived from completion time (+00:00), for ops and lifecycle.
- **Public read:** Third parties and **followed-identity viewers** fetch story metadata from the **author’s Syr instance** via a **public HTTP API**, analogous to public posts.
- **Home UX:** Logged-in user sees a **story tray** at the **top of the home feed**: own ring + rings for **followed** identities that have at least one active slide.
- **Profile entry:** Opening stories from the author’s **avatar** (feed or profile) launches the same **fullscreen viewer**.

### 2.2 Non-goals (v1)

- Replies, DMs, stickers, music, polls, or **collaborative** stories.
- **Server-side** “merged stories for all follows” API on the home instance (keep **per-provider** fetches like the timeline model).
- **End-to-end encryption** of story media.
- **Private** / followers-only stories (v1 is **public** only; future phase may add visibility).

---

## 3. Object storage layout (UTC +00:00)

Stories use the same **DID-namespaced** bucket layout as other uploads (see the **Storage layer** section in [apps/syr reference](/reference/app) and repo `s3/README.md`).

**Canonical object key (after upload completes):**

```text
uploads/{did}/stories/{UTC_YYYY-MM-DD}/public/{upload_ulid}
```

- `{UTC_YYYY-MM-DD}` is the **calendar date in UTC** at the moment the story asset is **finalized** (e.g. upload status `completed`), not the viewer’s local timezone.
- `{upload_ulid}` is the **local id** portion of the composite upload record id (`{ created_by: DID, id: ULID }`), consistent with existing upload keys.

**Rationale:** Date prefixes support **lifecycle rules**, debugging, and human browsing in the console without replacing the need for a **timestamp filter** for the 24-hour window (see §4).

**Anonymous read:** Paths remain under a `public` segment so existing bucket policies such as `Read:…/uploads/did:syr:*/public/*` continue to apply.

---

## 4. Rolling 24-hour visibility

**Definition:** A slide is **active** if:

```text
completed_at >= (now_utc - 24 hours)
```

where `completed_at` (or equivalent **`published_at`**) is stored in **UTC** and compared using a **rolling** window.

**Important:** The UTC **folder** for an object (§3) may be **yesterday’s** date while the slide is still active (e.g. uploaded 23 hours ago). Implementations **must not** expose slides using “list today’s prefix only”; they **must** filter by **timestamp** (database query and/or listing multiple date prefixes and filtering).

Expired objects may remain in storage until a **separate retention / GC** job deletes them; the **public API** only returns active slides.

---

## 5. Metadata model (implementation guidance)

**Recommended:** Reuse the existing **`upload`** table and **folder** hierarchy:

- Virtual folders: `stories` → `{UTC_YYYY-MM-DD}` → `public`, mirroring the S3 key layout.
- Each story slide is one **`upload`** row (composite id, `is_public: true`, `mime_type`, `size`, `url` / `key`, `created_at` / completion time).

**Alternative:** A dedicated `story_item` table with `upload_id` and `published_at` if product rules later diverge from generic uploads. v1 spec prefers **one code path** with folders + uploads for quotas, signing hooks, and export.

**Media constraints (v1 constants, TBD in implementation):**

- **Images:** common formats (e.g. JPEG, PNG, WebP, GIF).
- **Video:** short clips with **max duration** and **max byte size** enforced at presign / complete time.
- Reject disallowed MIME types at API boundary.

---

## 6. Public API (author’s instance)

**Endpoint (normative target):**

```text
GET /api/public/stories/{did}
```

- `{did}`: **`did:syr:…`** (URL-encoded as required).
- **Auth:** None for v1 (**public** stories).
- **Response:** JSON document listing **active** slides only (§4), ordered by **`published_at` ascending** (oldest first in the reel).

**Suggested response shape (illustrative):**

```json
{
	"status": "success",
	"data": {
		"did": "did:syr:z6Mk…",
		"slides": [
			{
				"id": "01HZ…",
				"mime_type": "image/jpeg",
				"url": "https://…/uploads/did:syr:…/stories/2025-03-26/public/01HZ…",
				"published_at": "2025-03-26T12:00:00.000Z",
				"width": 1080,
				"height": 1920,
				"duration_seconds": null
			}
		]
	}
}
```

Optional query parameter for efficiency: `?since=<ISO8601>` — server may still enforce the 24h cap.

**Errors:** `404` if DID unknown; `200` with empty `slides` if no active stories.

---

## 7. Cross-provider client flow

Aligned with [§9 of Follows, Discovery, and Home Timeline](/architecture/follows-and-timeline): the **browser** (or app) holds **follow rows** with **`followed_provider_url`**, resolves each **followed DID**’s **base URL**, and calls:

```text
GET {followed_provider_base}/api/public/stories/{followed_did}
```

Same-instance authors can use **relative** `/api/public/stories/…` on the current host.

```mermaid
sequenceDiagram
  participant Viewer as Viewer_browser
  participant Home as Home_Syr_API
  participant Author as Author_provider

  Note over Viewer,Home: Story tray on home
  Viewer->>Home: GET /api/follows
  Home-->>Viewer: rows with followed_did and followed_provider_url
  loop Each followed DID to show
    Viewer->>Author: GET /api/public/stories/{did}
    Author-->>Viewer: slides metadata and media URLs
  end
```

**Trust:** Story media URLs are **author-controlled**; viewers should treat them like **untrusted** remote content (CORS, size caps, codec support). **Seen / unseen** state is **out of scope** for v1 API; clients may use **local storage** or a future **KV** preference (documented as follow-up).

---

## 8. Product UX

| Surface              | Behavior                                                                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home (`/`)**       | If any active slides exist for **self** or **followed** DIDs, show a **horizontal tray** above the feed: avatars with a **ring**; tap opens fullscreen viewer starting at that author’s reel. |
| **Profile / avatar** | Tapping the author’s avatar (from tray, post header, or profile page) opens the **same viewer** for that DID’s active reel.                                                                   |
| **Empty**            | Hide the tray entirely when no active slides; no placeholder row required.                                                                                                                    |
| **Viewer**           | Fullscreen, tap or swipe to advance, dismiss to close; basic accessibility (focus trap, escape) in implementation.                                                                            |

---

## 9. Privacy and abuse

- v1 stories are **world-readable** once published (same exposure model as **public** post media under `public/` paths).
- **Rate limits** and **upload quotas** should apply to story uploads like other **`upload`** usage.
- **Reporting / moderation** is out of scope for v1 but may reuse future content-moderation tooling.

---

## 10. Implementation checklist (later)

- `@syr-is/types`: optional `PublicStorySlideSchema` / response wrapper.
- Folder + upload controller: presign path `stories/{UTC-date}/public/…`, enforce MIME/size.
- Route `GET /api/public/stories/[did]/+server.ts` (or equivalent).
- Home tray + viewer components; parallel fetch with **timeouts** and **partial failure** (skip unreachable providers).
- Tests: 24h boundary, UTC date folder, empty reel, cross-origin fetch mocks.
- Update **SeaweedFS** docs if policy strings need explicit mention of `stories/`.

---

## 11. Revision history

| Version | Summary                                                                     |
| ------- | --------------------------------------------------------------------------- |
| v1 spec | Initial architecture: UTC paths, rolling 24h, public API, tray + viewer UX. |
