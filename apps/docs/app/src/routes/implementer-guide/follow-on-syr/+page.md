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
GET /follow?target_did=<url-encoded did:syr>&provider=<url-encoded provider origin>
```

Example:

```text
https://my-syr.example/follow?target_did=did%3Asyr%3Az6Mk…&provider=https%3A%2F%2Fkodski.com
```

### Parameters

| Parameter    | Required | Description                                                                                                                                                                                                                                                     |
| ------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target_did` | yes      | Percent-encoded `did:syr` identifier of the person to follow                                                                                                                                                                                                    |
| `provider`   | no       | Percent-encoded origin URL of the third-party instance hosting the target identity. When set, the Syr instance fetches the profile from this provider instead of looking up locally or via registries. **Third-party implementers should always include this.** |

- Requires a **session** on that instance. Unauthenticated users are redirected to `/login`; after login they are sent back via a short-lived `post_login_redirect` cookie (same-origin paths only).
- `target_did` must be a valid `did:syr` identifier.
- When `provider` is given, it is stored as the `followed_provider_url` on the follow record, enabling the Syr instance to fetch posts, stories, and profile data from the correct origin.
- Following still goes through the instance’s **follow API** (`POST /api/follows`); this page is only a UX entry point.

### Profile page with provider

Third-party sites can also link to the profile view on the viewer’s Syr instance:

```text
GET /u/<url-encoded did:syr>?provider=<url-encoded provider origin>
```

When `?provider=` is present, the Syr instance skips local user lookup and fetches profile, posts, and uploads directly from the given provider.

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
	const MY_ORIGIN = window.location.origin; // your site's origin (the provider)
	document.getElementById('follow-syr')?.addEventListener('click', () => {
		const raw = document.getElementById('syr-base')?.value?.trim() ?? '';
		if (!raw) return;
		let base;
		try {
			base = new URL(raw).origin;
		} catch {
			return;
		}
		const q = new URLSearchParams({ target_did: TARGET_DID, provider: MY_ORIGIN });
		window.location.href = `${base}/follow?${q}`;
	});
</script>
```

**Trust note:** You are sending the user to a URL they typed. Encourage pasting only origins they trust (their own instance or a known community host).

---

## Related

- [Profile Sync API](/implementer-guide/profile-sync) — `identity_host_url` on the profile points to where someone’s public presence lives (may be your non-Syr site).
- Public profile JSON includes `identity_host_url` from `GET /api/public/profile/…`.
