---
title: Aegis — SYR Custodial Identity Protection v1
---

# Aegis — SYR Custodial Identity Protection v1

_The protected beginning. Your identity is born and shielded before self-sovereignty._

**Aegis** (SYR Custodial Identity Protection) defines how identities are born, encrypted, and stored on a hosting instance before the user assumes self-custody. Also known as CIGP in normative references.

---

# Custodial Identity Generation & Protection Specification (CIGP) — v1

## 1. Purpose

CIGP defines a **secure, production-grade architecture** for generating, storing, and later migrating **custodial Ed25519 identities** while enabling a seamless transition to **self-sovereign ownership**.

This specification is designed for:

- Conventional **email/password onboarding**
- **Server-assisted identity creation**
- Cryptographic **minimization of server custody**
- Future **client-owned export & migration**

CIGP intentionally avoids:

- PKCS#8 / PEM / X.509 dependence
- TLS identity assumptions
- Platform-specific key containers

---

## 2. Identity Root

### 2.1 Root Secret

```text
seed: 32 random bytes
algorithm: Ed25519
```

All signing keys **MUST** be deterministically derived from this seed.

The **seed is the sole high-value secret** in the system.

---

## 3. Threat Model

CIGP v1 protects against:

- Database compromise
- Insider read access
- Passive network interception
- Offline brute-force attacks (bounded by password strength + KDF)

CIGP v1 does **NOT** protect against:

- Live malicious server code
- Weak user passwords
- Fully compromised client device

---

## 4. High-Level Architecture

```text
Server generates seed
→ Immediately encrypted with user-derived key
→ Server stores ONLY encrypted seed
→ Client decrypts locally after login
→ Optional export → self-sovereign mode
```

**Key invariant:**

> Server MUST never persist plaintext seed after initial wrapping.

---

## 5. Custodial Generation Flow (Normative)

### 5.1 Inputs

```text
user_password (UTF-8)
```

---

### 5.2 Steps

1. **Generate seed**

   ```text
   seed = CSPRNG(32 bytes)
   ```

2. **Generate KDF salt**

   ```text
   salt = CSPRNG(16 bytes)
   ```

3. **Derive user encryption key**

   ```text
   K_user = Argon2id(password, salt, params)
   output length = 32 bytes
   ```

4. **Encrypt seed**

   ```text
   nonce = CSPRNG(12 bytes)

   ciphertext, tag = AES-256-GCM(
       key = K_user,
       nonce = nonce,
       plaintext = seed,
       AAD = "cigp:v1"
   )
   ```

5. **Derive public key**

   ```text
   pub = Ed25519(seed).public
   ```

6. **Zero plaintext seed from server memory**

7. **Persist record**

```text
{
  pub,
  salt,
  kdf_params,
  nonce,
  ciphertext,
  tag,
  created_at
}
```

Server MUST NOT store:

- plaintext seed
- derived encryption key
- user password

---

## 6. Cryptographic Requirements

### 6.1 KDF

**Algorithm:** Argon2id
**Output:** 32 bytes

**Default parameters:**

```text
memory: 64 MiB
iterations: 3
parallelism: 1
salt: 16 bytes
```

Servers MAY increase cost but MUST store parameters per-user.

---

### 6.2 Encryption

**Algorithm:** AES-256-GCM

```text
nonce: 12 bytes random
tag: 16 bytes
AAD: "cigp:v1"
plaintext: 32-byte seed
```

---

## 7. Login & Decryption Flow

### 7.1 Client-Side Steps

1. User enters password.
2. Client downloads encrypted seed bundle.
3. Client derives:
   ```text
   K_user = Argon2id(password, salt, params)
   ```
4. Client decrypts AES-GCM.
5. If authentication fails → **abort login**.
6. Client reconstructs Ed25519 private key locally.
7. Seed SHOULD be kept only in:

```text
secure memory
or
OS secure storage (Keychain / Keystore)
```

---

## 8. Password Change Procedure

To change password **without exposing seed**:

1. Locally decrypt the seed with the current password.
2. Derive new `K_user'` with the new password and salt.
3. Re-encrypt the seed and upload the new encrypted bundle.
4. Server replaces the old record atomically.

Server never sees plaintext.

---

## 9. Migration to Self-Sovereign Mode

CIGP integrates with **Sigil (PIEF) v1 export**:

```text
decrypt seed locally
→ create encrypted export blob
→ store seed in device secure storage
→ mark account as non-custodial
→ optionally delete server copy
```

After migration:

> Server MUST NOT retain usable encrypted seed.

---

## 10. Multi-Device Access (Custodial Phase)

Two supported models:

### 10.1 Password Re-Decryption (v1 default)

Each device:

```text
downloads encrypted seed
→ derives K_user
→ decrypts locally
```

No seed transmission between devices required.

---

### 10.2 Future Extension

- Device wrapping keys
- Passkey-based unlock
- Threshold recovery

Deferred to **CIGP v2**.

---

## 11. Security Requirements

### 11.1 Memory Handling

Implementations SHOULD:

- Zero plaintext seed after encryption/decryption
- Avoid logging sensitive buffers
- Use constant-time comparisons

---

### 11.2 Rate Limiting

Servers MUST enforce:

- Login attempt throttling
- Progressive delays
- Optional proof-of-work or CAPTCHA

To mitigate **offline KDF brute force** after DB leak.

---

### 11.3 Password Policy

UI SHOULD require:

```text
minimum length ≥ 10
OR entropy ≥ 50 bits
```

Encourage passphrases over complexity rules.

---

## 12. Data Breach Analysis

If database leaks:

Attacker obtains only:

```text
salt
kdf params
nonce
ciphertext
tag
public key
```

Security reduces to:

> Strength of Argon2id parameters + user password entropy.

No plaintext identities exposed.

---

## 13. Versioning

```text
scheme identifier: "cigp"
version: 1
AAD string: "cigp:v1"
```

Future versions MUST:

- Increment version
- Allow parallel decoding
- Never reinterpret v1 ciphertext

---

## 14. Implementation Guidance

### 14.1 Preferred Crypto Libraries

- iOS/macOS → CryptoKit + Argon2 library
- Android → Tink / BouncyCastle Argon2
- Node → libsodium / argon2 + native AES-GCM
- Web → WebCrypto + WASM Argon2

---

### 14.2 Minimum Secure Defaults

If unsure, implement exactly:

```text
Argon2id: 64 MiB, t=3, p=1
AES-256-GCM
12-byte nonce
32-byte seed
```

This is safe for **2026 consumer threat models**.

---

# End of CIGP v1
