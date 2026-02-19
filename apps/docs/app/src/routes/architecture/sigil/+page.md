---
title: Sigil — SYR Portable Identity Export Format v1
---

# Sigil — SYR Portable Identity Export Format v1

_Identity becoming self-owned. The moment you carry your root identity._

**Sigil** (SYR Portable Identity Export Format) is the export format for carrying your Ed25519 identity seed from custodial protection into self-sovereignty. Also known as PIEF in normative references.

---

# Portable Identity Export Format (PIEF) — v1 Specification

## 1. Purpose

PIEF defines a **portable, encrypted container** for exporting an Ed25519 identity seed from a custodial environment to a **self-sovereign device** without relying on:

- PKCS#8
- PEM
- X.509
- OpenSSL tooling

The format is designed for:

- Cross-platform interoperability (iOS, Android, Web, Desktop, Server)
- Client-side cryptographic ownership
- Future-proof versioning
- Safe transmission via file, clipboard, or QR

---

## 2. Root Identity Model

**Root secret:**
A 32-byte Ed25519 seed.

```
seed: Uint8Array(32)
```

All keypairs MUST be deterministically derived from this seed using standard Ed25519 rules.

The seed is the **only secret that must be protected**.

---

## 3. Security Goals

PIEF v1 guarantees:

- Confidentiality of seed via **AEAD encryption**
- Integrity/authentication of payload
- Password-based portability
- Server independence during export
- Forward-compatible extensibility

PIEF v1 explicitly **does NOT guarantee**:

- Resistance to weak export passphrases
- Multi-party recovery
- Post-quantum security

These are deferred to future versions.

---

## 4. High-Level Export Flow

1. Client decrypts custodial wrapped seed locally.
2. User chooses **export passphrase** (distinct from login password).
3. Client derives encryption key via **memory-hard KDF**.
4. Seed encrypted using **AES-256-GCM**.
5. Result serialized into **PIEF JSON object**.
6. JSON encoded as:
   - base64url string **OR**
   - `.sigil` file **OR**
   - QR payload (chunked if necessary).

All cryptographic operations MUST occur **client-side**.

---

## 5. Cryptographic Primitives (v1)

### 5.1 KDF

**Algorithm:** Argon2id
**Output length:** 32 bytes
**Parameters (REQUIRED defaults):**

```
memory: 64 MiB
iterations: 3
parallelism: 1
salt length: 16 bytes
```

Implementations MAY increase memory/iterations but MUST remain compatible with provided values.

---

### 5.2 Encryption

**Algorithm:** AES-256-GCM

```
key length: 32 bytes
nonce length: 12 bytes
tag length: 16 bytes
plaintext: 32-byte seed
AAD: ASCII string "pief:v1"
```

---

## 6. Data Structure

### 6.1 Canonical JSON Object

```json
{
	"v": 1,
	"kdf": {
		"name": "argon2id",
		"salt": "<base64url>",
		"mem": 65536,
		"it": 3,
		"par": 1
	},
	"enc": {
		"name": "aes-256-gcm",
		"nonce": "<base64url>",
		"ct": "<base64url>",
		"tag": "<base64url>"
	},
	"pub": "<multibase-ed25519-public-key>"
}
```

---

### 6.2 Field Definitions

#### `v`

Format version.
Must equal **1** for this specification.

---

#### `kdf`

Key derivation parameters.

| Field | Type      | Description        |
| ----- | --------- | ------------------ |
| name  | string    | MUST be "argon2id" |
| salt  | base64url | 16 random bytes    |
| mem   | integer   | Memory in KiB      |
| it    | integer   | Iterations         |
| par   | integer   | Parallelism        |

---

#### `enc`

Encrypted seed container.

| Field | Type      | Description           |
| ----- | --------- | --------------------- |
| name  | string    | MUST be "aes-256-gcm" |
| nonce | base64url | 12 random bytes       |
| ct    | base64url | Ciphertext of seed    |
| tag   | base64url | 16-byte GCM tag       |

---

#### `pub`

Multibase-encoded Ed25519 public key derived from decrypted seed.
Used for:

- Identity preview
- Import validation
- Duplicate detection

---

## 7. Encoding Rules

### 7.1 Base64url

All binary fields MUST use **RFC 4648 base64url without padding**.

---

### 7.2 Canonical Serialization

Before QR or file encoding:

- JSON MUST use UTF-8
- Keys MUST remain in defined order
- No whitespace requirements
- Unknown fields MUST be ignored (forward compatibility)

---

## 8. Export Procedure (Normative)

```
INPUT:
  seed (32 bytes)
  export_passphrase (UTF-8 string)

STEPS:
  1. Generate random 16-byte salt.
  2. Derive K = Argon2id(passphrase, salt, params).
  3. Generate random 12-byte nonce.
  4. Encrypt seed with AES-256-GCM using:
       key = K
       nonce = nonce
       AAD = "pief:v1"
  5. Derive public key from seed.
  6. Construct JSON object per Section 6.
  7. Encode for transport.
```

---

## 9. Import Procedure (Normative)

```
INPUT:
  PIEF object
  export_passphrase

STEPS:
  1. Verify version == 1.
  2. Recompute K via Argon2id.
  3. AES-GCM decrypt using stored nonce + tag.
     - If authentication fails → abort.
  4. Verify derived public key == `pub`.
     - If mismatch → abort.
  5. Store seed in secure device storage (e.g., Keychain).
```

---

## 10. Transport Formats

### 10.1 File

Extension:

```
.sigil
```

MIME (recommended):

```
application/sigil+json
```

---

### 10.2 QR

Maximum single-QR payload target:

```
≤ 2.5 KB
```

Larger payloads MUST use **QR chunking with sequence numbers** (future appendix).

---

## 11. Error Handling

Implementations MUST fail import if:

- Unknown `v`
- Unsupported KDF or cipher
- AEAD authentication failure
- Public key mismatch
- Malformed base64url

No partial recovery allowed.

---

## 12. Versioning & Forward Compatibility

Future versions:

- MUST increment `v`
- MAY change algorithms
- MUST NOT silently reinterpret v1 fields

v1 readers MUST ignore unknown top-level fields.

---

## 13. Security Considerations

### 13.1 Passphrase Strength

Security depends entirely on **export passphrase entropy**.
UI SHOULD enforce:

```
minimum length ≥ 10
or entropy ≥ 50 bits
```

---

### 13.2 Clipboard Leakage

Apps SHOULD warn users when copying export strings.

---

### 13.3 Memory Zeroization

Seed and derived keys SHOULD be zeroed after use where platform permits.

---

## 14. Reference Test Vector (Structure Only)

```
seed: 32 bytes random
salt: 16 bytes random
nonce: 12 bytes random
AAD: "pief:v1"
```

(Full deterministic vectors defined in future appendix.)

---

# End of PIEF v1
