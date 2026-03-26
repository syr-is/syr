---
title: Public read API (instance-scoped)
---

# Public read API (instance-scoped)

These endpoints expose **read-only** data for identities hosted on a given Syr instance. They require **no session cookie** and **no `Authorization` header**. Clients that already know the instance base URL (for example `https://syr.example.com`) call them with that origin as the host.

**Implementation:** `apps/syr/app/src/routes/api/public/**`  
**CORS logic:** `apps/syr/app/src/hooks.server.ts`, `apps/syr/app/src/lib/server/cors-public-api.server.ts`, `apps/syr/app/src/lib/config.ts`  
**Discovery hints:** `GET /.well-known/syr` returns `public_url` and template paths for profile and posts (see **Discovery** at the end of this page).

---

## Conventions

### Base URL

All paths below are relative to the instance origin (the same base as the `PUBLIC_URL` setting), e.g. `https://your-instance.example/api/public/...`.

### Path encoding

- **`did:syr:…`** values must be **percent-encoded** in URL path segments (`encodeURIComponent`), because they contain `:` and other reserved characters.
- **Usernames** in the profile route should also be encoded if they contain reserved characters.

### Success response envelope

Successful JSON responses include **`"status": "success"`** and **`data`**. Some endpoints add **`meta`** (e.g. timestamp) or top-level **`pagination`**.

Paginated list responses look like:

```json
{
	"status": "success",
	"data": [ ... ],
	"pagination": {
		"limit": 30,
		"offset": 0,
		"total": 42,
		"has_more": true
	}
}
```

### Errors

Handlers use SvelteKit `error()` with HTTP status **400** (bad DID / bad request), **404** (not found), or **500** (internal). Clients should not rely on a single global error JSON schema; treat non-2xx bodies as implementation-defined.

### Visibility rules (posts and uploads)

- **Posts** included in public APIs are **`visibility === 'public'`** and **`status === 'completed'`** only.
- **Uploads** in the public uploads list are **`is_public === true`**, **`status === 'completed'`**, and have a stored **`url`**.

---

## CORS

### Which routes are “public API” for CORS?

A request is treated as a **public API read** when:

- **Path** starts with `/api/public/`, and
- **Method** is **`GET`** or **`OPTIONS`** (preflight).

See `isPublicApiReadRequest()` in `cors-public-api.server.ts`.

### Allowed origins (default)

For **all** routes, including public API:

- If the request sends an **`Origin`** header, it must be allowed unless the reflect-any-origin mode below applies.
- Allowed origins come from **`ALLOWED_ORIGINS`** (comma-separated) if set; otherwise **`PUBLIC_URL`** only (normalized to origin).
- **`CORS_CREDENTIALS`**: when `true` and the origin is allowed, responses can include **`Access-Control-Allow-Credentials: true`** (but not when reflect-any-origin public mode is used for that request).

In **development**, LAN-style origins may be accepted via `@syr-is/utils` (`isAllowedOrigin`); see `config.ts`.

### Reflect any origin for `/api/public/*` only

Environment variable: **`CORS_REFLECT_ANY_ORIGIN_PUBLIC_API`** (default **`false`**).

When **`true`**:

- For **`GET`** and **`OPTIONS`** to **`/api/public/*`**, if **`Origin`** is present and is a valid **`http:`** or **`https:`** URL, the server may treat that origin as allowed and set  
  **`Access-Control-Allow-Origin`** echoing the request **`Origin`** header value.
- **`Access-Control-Allow-Credentials` is not set** for these reflected public reads (browser cross-origin calls must use **credentialed: false**).
- **All other routes** still require **`ALLOWED_ORIGINS` / `PUBLIC_URL`** as usual.

When **`false`**, cross-origin **`fetch`** to public API from another site only works if that site’s origin is listed in **`ALLOWED_ORIGINS`** (or dev LAN rules).

### Preflight (`OPTIONS`)

- Allowed preflight returns **204** with `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, `Access-Control-Max-Age`, and `Vary: Origin`.
- If **`Origin`** is present but **not** allowed, preflight returns **403**.

### Other response headers

`hooks.server.ts` also sets **`Vary: Origin`** on responses, **`X-Content-Type-Options: nosniff`**, **`X-Frame-Options: DENY`**, **`X-XSS-Protection`**.

---

## `GET /api/public/profile/[param]`

Route file: `api/public/profile/[param]/+server.ts`. The last path segment is resolved to a user by:

- **`did:syr:…`** (validated with `isValidSyrDid`), or
- **username** (otherwise).

### Response `data`

| Field                       | Type            | Description                                  |
| --------------------------- | --------------- | -------------------------------------------- |
| `did`                       | string \| null  | User’s DID if set                            |
| `username`                  | string          | Login username                               |
| `display_name`              | string          | Profile display name                         |
| `bio`                       | string          | Profile bio                                  |
| `avatar_url`                | string \| null  | Resolved avatar URL                          |
| `banner_url`                | string \| null  | Resolved banner URL                          |
| `identity_host_url`         | string \| null  | Optional public “home” URL for this identity |
| `content_signature`         | string \| null  | Signature over profile payload (if used)     |
| `signed_payload_json`       | unknown \| null | Signed payload (if used)                     |
| `signing_device_public_key` | string \| null  | Device key reference for verification UI     |

### Errors

- **404** if user or profile record is missing.

---

## `GET /api/public/posts/[did]`

Route file: `api/public/posts/[did]/+server.ts`. Lists **public, completed** posts authored by the given **`did:syr`** (`id.created_by` on the composite post id), newest first.

### Query parameters

| Parameter | Default                                        | Constraints                                                                        | Purpose                                               |
| --------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `limit`   | **30** if `full` is absent; **24** if `full=1` | Clamped **1–100** (handler); repository caps at **200** internally for the DB page | Page size                                             |
| `offset`  | `0`                                            | ≥ 0                                                                                | Pagination offset                                     |
| `full`    | off                                            | `1` to enable                                                                      | Return **full** post records plus media metadata maps |

### Response without `full=1` (default)

- **`data`**: array of **post metadata** objects (not the full `Post` entity). Each item includes fields such as `did`, `local_id`, `type`, `title`, `description`, `visibility`, `status`, `created_at`, `updated_at`, content signature fields, and type-specific fields (`media_urls` / `display_mode` for media posts, `content_type` for blog posts).
- **`pagination`**: `limit`, `offset`, `total`, `has_more`.

### Response with `full=1`

- **`data`**: full serialized posts with string `id`, `did`, `local_id`, `author_id`, ISO string dates.
- **`mediaUrlMimeTypes`**, **`mediaUrlFilenames`**: maps keyed by media URL for client display.
- **`pagination`**: same shape as above.

### Errors

- **400** if `did` is not a valid `did:syr`.

---

## `GET /api/public/posts/[did]/[localId]`

Route file: `api/public/posts/[did]/[localId]/+server.ts`. Returns a **single** public post. **`localId`** is the ULID segment of the composite post id (together with **`did`** in the path).

### Response `data`

Full post object with normalized fields: `id` (string), `did`, `local_id`, `author_id` (string), plus the post fields from storage.

### Errors

- **400** invalid DID or encoding.
- **404** if the post does not exist or is not **public** + **completed**.

---

## `GET /api/public/stories/[did]`

Route file: `api/public/stories/[did]/+server.ts`. Returns **profile story slides** for the DID: uploads that are public, completed, have `url` and `key`, whose storage key path contains **`/stories/`**, and whose **`updated_at`** is within the **last 24 hours** (rolling window from server time). Ordered by **`updated_at`** ascending (up to **200** rows from DB, then filtered).

### Response

```json
{
	"status": "success",
	"data": {
		"did": "did:syr:…",
		"slides": [
			{
				"id": "ulid",
				"mime_type": "image/jpeg",
				"url": "https://…",
				"published_at": "2026-03-26T12:00:00.000Z",
				"width": 1080,
				"height": 1920,
				"duration_seconds": null
			}
		]
	},
	"meta": { "timestamp": "…" }
}
```

Schema: `PublicStoriesResponseSchema` in `@syr-is/types` (`packages/ts/types/src/stories.ts`). Slide `width` / `height` / `duration_seconds` may be null when unknown.

### Errors

- **400** invalid DID.
- **500** if assembled payload fails schema validation (should be rare).

---

## `GET /api/public/uploads/[did]`

Route file: `api/public/uploads/[did]/+server.ts`. Paginated list of **public, completed** uploads for the DID (general gallery / directory use—not limited to stories).

### Query parameters

| Parameter | Default | Constraints       |
| --------- | ------- | ----------------- |
| `limit`   | **24**  | Clamped **1–100** |
| `offset`  | `0`     | ≥ 0               |

### Response `data`

Array of objects with: `id`, `did`, `local_id`, `owner_id`, `folder_id`, `filename`, `mime_type`, `size`, `url`, `status`, `is_public`, `created_at`, `updated_at` (ISO strings).

### Errors

- **400** invalid DID.

---

## Discovery: `/.well-known/syr`

`GET /.well-known/syr` returns JSON including:

- **`public_url`**: instance public base URL
- **`api.public_profile`**: base path for profile API; append `/` plus username or percent-encoded DID.
- **`api.public_posts`**: base path for posts API; append `/` plus author DID, and optionally `/` plus post `localId` for one post.

It does **not** yet list stories or uploads; clients should use the paths documented above when needed.

---

## Related documentation

- [apps/syr reference](/reference/app) — authenticated APIs and app architecture
- [Spec-to-Implementation Map](/reference/spec-mapping) — requirement traceability
- [Profile stories (v1 spec)](/architecture/profile-stories) — story storage layout and product behavior
- [Follows, Discovery & Home Timeline](/architecture/follows-and-timeline) — how clients pick provider URLs
- [Follow on Syr](/implementer-guide/follow-on-syr) — follow flow and `identity_host_url`
