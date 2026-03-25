---
title: Follow on Syr (third-party sites)
---

# Follow on Syr (third-party sites)

Publishers who host a **public identity** outside Syr (personal site, blog, etc.) can still let visitors **follow their `did:syr` on the visitor’s own Syr instance**.

The viewer must be logged into **their** Syr instance. Your page collects that instance’s base URL (or you deep-link to a known instance), then sends them to the **follow intent** path on that instance.

---

## Intent URL

On any Syr instance, the authenticated follow flow is:

```text
GET /follow?target_did=<url-encoded did:syr>
```

Example:

```text
https://my-syr.example/follow?target_did=did%3Asyr%3Az6Mk…
```

- Requires a **session** on that instance. Unauthenticated users are redirected to `/login`; after login they are sent back via a short-lived `post_login_redirect` cookie (same-origin paths only).
- `target_did` must be a valid `did:syr` identifier.
- Following still goes through the instance’s **registry / follow API** rules (`POST /api/follows`); this page is only a UX entry point.

---

## Embed pattern

You know the **subject DID** (e.g. from your Sigil export or static config). You ask the visitor for **their Syr base URL** (the origin they use to log in), then navigate:

```html
<label>
	Your Syr instance URL
	<input id="syr-base" type="url" placeholder="https://your-syr.example" />
</label>
<button type="button" id="follow-syr">Follow on Syr</button>
<script>
	const TARGET_DID = 'did:syr:z6Mk…'; // your DID
	document.getElementById('follow-syr')?.addEventListener('click', () => {
		const raw = document.getElementById('syr-base')?.value?.trim() ?? '';
		if (!raw) return;
		let base;
		try {
			base = new URL(raw).origin;
		} catch {
			return;
		}
		const q = new URLSearchParams({ target_did: TARGET_DID });
		window.location.href = `${base}/follow?${q}`;
	});
</script>
```

**Trust note:** You are sending the user to a URL they typed. Encourage pasting only origins they trust (their own instance or a known community host).

---

## Related

- [Profile Sync API](/implementer-guide/profile-sync) — `identity_host_url` on the profile points to where someone’s public presence lives (may be your non-Syr site).
- Public profile JSON includes `identity_host_url` from `GET /api/public/profile/…`.
