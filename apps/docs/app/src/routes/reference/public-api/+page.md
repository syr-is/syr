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

## `GET /api/public/following/[did]`

Route file: `api/public/following/[did]/+server.ts`. Returns the list of DIDs that this user **publicly follows**. Only follows where the user has opted in to public visibility (`is_public = true`) are included.

### Response `data`

Array of objects:

| Field                   | Type           | Description                                   |
| ----------------------- | -------------- | --------------------------------------------- |
| `followed_did`          | string         | The DID being followed                        |
| `followed_provider_url` | string \| null | Provider URL where the followed DID is hosted |
| `created_at`            | string         | ISO 8601 timestamp                            |

### Response `pagination`

| Field   | Type   | Description          |
| ------- | ------ | -------------------- |
| `total` | number | Total public follows |

### Errors

- **400** invalid DID.

### Client-side enrichment

The response only contains DIDs and provider URLs. To display usernames, avatars, and display names, clients should **enrich each entry** by fetching the profile from the followed DID's provider:

1. Use `followed_provider_url` to build a manifest URL — DIDs contain `:` and must be percent-encoded with `encodeURIComponent()` in path segments
2. Fetch the manifest to get `endpoints.profile` (or fall back to `{provider}/api/public/profile/{encoded_did}`)
3. Fetch the profile for `username`, `display_name`, `avatar_url`
4. Display as `@username@provider.host` with avatar

This is the same enrichment pattern used by the home timeline and following list.

---

## `GET /api/identity/[did]/rotations`

Route file: `api/identity/[did]/rotations/+server.ts`. Returns the **ordered root-key rotation chain** for the DID. Public, unauthenticated, served with `Cache-Control: public, max-age=300` (same treatment as the DID document endpoint). Verifiers replay the chain from the DID-derived **genesis** key to resolve the **current** root key — see [Root key rotation](/architecture/recovery-rotation).

### Response (bare object, like the DID document endpoint)

| Field          | Type   | Description                                                       |
| -------------- | ------ | ----------------------------------------------------------------- |
| `did`          | string | The identity's DID                                                |
| `current_root` | string | Multibase current root public key (last `newRoot`, or genesis)   |
| `rotations`    | array  | Ordered rotation statements (seq 1..n); empty when never rotated |

Each rotation statement: `{ did, seq, prevRoot, newRoot, rotatedAt, signature }` (`RotationStatementSchema` in `@syr-is/types`).

### Errors

- **400** invalid DID.
- **404** if the identity is not hosted on this instance.

---

## Discovery

### Instance-level: `GET /.well-known/syr`

Returns JSON including:

- **`public_url`**: instance public base URL
- **`api.public_profile`**: base path for profile API; append `/` plus username or percent-encoded DID.
- **`api.public_posts`**: base path for posts API; append `/` plus author DID, and optionally `/` plus post `localId` for one post.
- **`api.public_stories`**: base path for stories API; append `/` plus author DID.
- **`api.public_uploads`**: base path for uploads API; append `/` plus author DID.
- **`identity_manifest_template`**: URL template for per-identity manifests; replace `{did}` with the percent-encoded DID.
- **`syner`** (optional): Syner companion app endpoint URL templates with `{id}` placeholder for dynamic IDs.

#### Syner endpoint templates (`syner` object)

URL templates for operational flows used by the Syner companion app. Third-party providers implementing the Syr protocol serve these at their own route structure. The `{id}` placeholder is replaced with the actual challenge/session ID.

| Key                           | Default Syr path                             | Usage                     |
| ----------------------------- | -------------------------------------------- | ------------------------- |
| `independent_login_challenge` | `/api/auth/independent-login/challenge/{id}` | GET challenge by ID       |
| `independent_login_verify`    | `/api/auth/independent-login/verify`         | POST signed challenge     |
| `profile_sync`                | `/api/auth/independent-login/profile-sync`   | POST profile sync         |
| `export_challenge`            | `/api/identity/export-challenge/{id}`        | GET export challenge      |
| `export_verify`               | `/api/identity/export-verify`                | POST export verification  |
| `export_signatures`           | `/api/identity/export-signatures`            | POST export signatures    |
| `sigil_handoff_payload`       | `/api/user/sigil-handoff/{id}/payload`       | POST sigil handoff        |
| `post_sign_payload`           | `/api/user/post-sign/{id}/payload`           | GET post signing payload  |
| `post_sign_signature`         | `/api/user/post-sign/{id}/signature`         | PUT post signature        |
| `registry_sign_payload`       | `/api/user/registry-sign/{id}/payload`       | GET registry sign payload |
| `registry_sign_signature`     | `/api/user/registry-sign/{id}/signature`     | PUT registry signature    |

If `syner` is absent from the instance manifest, clients fall back to the default Syr paths shown above.

### Per-identity manifest: `GET /.well-known/syr/[did]`

Route file: `.well-known/syr/[did]/+server.ts`. Returns a **per-identity manifest** that advertises the absolute URLs for all public API endpoints for the given DID.

#### Content negotiation

- **`Accept: application/json`** → manifest JSON with `Cache-Control: public, max-age=300`
- **`Accept: text/html`** (or default/browser) → **302 redirect** to `web_profile`

#### Manifest `data`

| Field                        | Type              | Description                              |
| ---------------------------- | ----------------- | ---------------------------------------- |
| `version`                    | `1`               | Schema version                           |
| `did`                        | string            | The identity's DID                       |
| `provider`                   | string            | Canonical provider origin URL            |
| `endpoints.profile`          | string            | Absolute URL for public profile API      |
| `endpoints.posts`            | string            | Absolute URL for public posts API        |
| `endpoints.stories`          | string            | Absolute URL for public stories API      |
| `endpoints.uploads`          | string            | Absolute URL for public uploads API      |
| `endpoints.did_document`     | string            | Absolute URL for DID document            |
| `endpoints.rotations`        | string (optional) | Absolute URL for the root-key rotation chain |
| `endpoints.public_following` | string (optional) | Absolute URL for public following list   |
| `endpoints.public_emojis`    | string (optional) | Absolute URL for user's emoji catalog    |
| `endpoints.public_gifs`      | string (optional) | Absolute URL for user's GIF catalog      |
| `endpoints.public_comments`  | string (optional) | Absolute URL for user's public comments  |
| `endpoints.public_reactions` | string (optional) | Absolute URL for user's public reactions |
| `web_profile`                | string            | Human-viewable profile page URL          |

#### Errors

- **400** if DID is not a valid `did:syr:`.
- **404** if the identity is not hosted on this instance.

#### Fallback

If a remote provider does not serve a manifest (404 or non-JSON), clients should fall back to the conventional hardcoded paths documented above.

---

## Related documentation

- [apps/syr reference](/reference/app) — authenticated APIs and app architecture
- [Spec-to-Implementation Map](/reference/spec-mapping) — requirement traceability
- [Profile stories (v1 spec)](/architecture/profile-stories) — story storage layout and product behavior
- [Follows, Discovery & Home Timeline](/architecture/follows-and-timeline) — how clients pick provider URLs
- [Follow on Syr](/implementer-guide/follow-on-syr) — follow flow and `identity_host_url`
