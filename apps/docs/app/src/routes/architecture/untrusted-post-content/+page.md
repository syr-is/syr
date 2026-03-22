---
title: Untrusted post content
---

# Untrusted post content (sanitization, sources, consent)

Blog and media posts can carry **untrusted** HTML, markdown, and remote URLs. Cryptographic signatures prove **authorship and integrity of the stored payload**, not that embedded resources are safe to load in the browser.

## Layers

1. **Sanitization** — Before any `{@html}` render, post bodies run through **DOMPurify** with a strict tag/attribute allowlist (`apps/syr/app/src/lib/client/sanitize-post-body.ts`). Markdown is compiled with `marked` first, then sanitized. This removes executable vectors (scripts, most dangerous URLs) but **does not** stop `<img>` / `<video>` / etc. from loading if their `src` survives sanitization.

2. **Source listing** — The app enumerates URLs that could trigger network loads: `media_urls` plus subresources found in HTML (or markdown-generated HTML) via `DOMParser` (`extract-subresource-urls.ts`, `post-sources.ts`).

3. **Trust rules** — Users maintain ordered **allow** and **deny** patterns (full URLs; path prefixes; limited globs with `*` / `**` on the path) under **Settings → Content trust**, stored in `user_content_trust_rule`. Evaluation: **any deny** → blocked; **any allow** → allowed; optional implicit allows from the author’s **publication** registry origins when enabled; **same origin** as the SYR instance → allowed; else **unknown** (blocked until consent or a new rule). Deny rules still apply after per-post consent.

4. **Consent** — On the post detail page, unknown remote sources show a summary card. The viewer can load external media for that post snapshot (stored per device: `localStorage` when signed in, `sessionStorage` when not), choose sanitized **text only**, or add an allow rule. **Feed / list previews** do not fetch cross-origin thumbnails; open the post to load them after trust/consent.

5. **Client post JSON size limits** — Logged-in users can set a **max decoded post payload** (UTF-8 estimate over post body, signatures, `media_urls`, etc.) under **Settings → Content trust**. List endpoints (`/api/posts`, pinned) are loaded with a **raw response** cap before `JSON.parse`, then each post is checked after parse so compression cannot hide an oversized decoded body. The **following timeline** uses the same limit on `fetch` of each public post JSON; **Load anyway** stores a **session-only** override in `sessionStorage` for that post or URL. **Private post detail** loaded via SSR still receives the full post from the server (no client fetch); a server-side cap there is a possible follow-up.

## References

- Matcher + tests: `apps/syr/app/src/lib/content-trust/matcher.ts`, `matcher.test.ts`
- APIs: `GET`/`PUT` `/api/user/content-trust`, `POST` `/api/user/content-trust/append`, `GET`/`PATCH` `/api/user/content-limits`
