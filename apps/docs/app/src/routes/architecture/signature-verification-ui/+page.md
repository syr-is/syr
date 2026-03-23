---
title: Signature Verification UI (Profile and Posts)
---

# Signature Verification UI (Profile and Posts)

## 1. Purpose

Provide a **simple, explicit** way for users to confirm that a **profile** or **post** was **signed by the owner** of a `did:syr` — using the **public key embedded in the DID** and the stored **signature** over the [canonical payload](/architecture/signed-profile-post-mutations).

This is **not** a certificate viewer; it is a minimal integrity and attribution surface.

---

## 2. What the user sees

| Element              | Description                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DID**              | Full `did:syr:...` string with copy-to-clipboard.                                                                                                          |
| **Public key**       | Derived from the DID (multibase or short **fingerprint** / first/last hex) so users can correlate with other tools.                                        |
| **Signature status** | **Valid** or **Invalid** (or **Unknown** if data missing), from re-running JCS canonicalization + Ed25519 verify using `@syr-is/crypto` and `@syr-is/did`. |
| **Optional**         | Expandable “canonical payload” or hash for advanced users and support.                                                                                     |

---

## 3. Where it appears

| Surface                | Notes                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Profile**            | Settings / profile view for the **signed-in** user’s own profile; later on public **`u/...`** profile when public reads exist.                                |
| **Posts**              | **Post detail** and optionally a compact indicator on **post cards** in lists (e.g. checkmark + tooltip).                                                     |
| **Follows / timeline** | When [timeline](/architecture/follows-and-timeline) loads remote posts, each row that exposes signature fields should offer the same verification affordance. |

---

## 4. Behavior

1. Read the **same fields** the server used to build the signed object (from API response or stored JSON).
2. Build the **payload object** per [signed profile/post mutations](/architecture/signed-profile-post-mutations) (field order irrelevant before JCS).
3. `canonicalize(payload)` then `verify(canonicalBytes, decodeMultibase(signature), publicKeyFromDid(did))` (or verify delegation chain if implementation uses device keys).
4. Show result; on failure, show short reason (e.g. “signature does not match payload”).

No additional trust anchor: verification is **local** to displayed data.

---

## 5. Loading UX — Svelte await blocks

Verification may be **async** (e.g. lazy import of crypto, or fetching DID document). Use Svelte **await blocks** (or equivalent promise-bound UI) so the user always sees a **pending** state (spinner/skeleton) then **valid / invalid / error**. Pattern:

```svelte
{#await verifySignature()}
	<p>Checking signature…</p>
{:then ok}
	<p>{ok ? 'Valid' : 'Invalid'}</p>
{:catch e}
	<p>Error: {e.message}</p>
{/await}
```

Same pattern applies on the [home timeline](/architecture/follows-and-timeline) for meta loads and full post hydration.

---

## 6. Non-goals

- Full PKI chain UI, OCSP, or third-party attestation display.
- Editing or re-signing from this panel (belongs in compose/edit flows).

---

## 7. Dependencies

- API responses must include **`did`**, **signature**, and enough **fields** to reconstruct the signed payload (see persistence §6 in [signed mutations](/architecture/signed-profile-post-mutations)).
