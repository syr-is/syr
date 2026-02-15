# Key storage adapter

Abstract adapter for storing and using Ed25519 identity keys in the browser. The implementation is chosen at runtime by env.

## Env

- **`VITE_KEY_STORAGE_ADAPTER`** (optional)
  - `indexeddb` (default) – private keys stored in plaintext in IndexedDB. Dev only.
  - `webcrypto` – Web Crypto API: keys generated with `extractable: true`, exported, encrypted with a random KEK (stored in sessionStorage), and persisted in IndexedDB; on load they are decrypted and imported with `extractable: false`. Same-origin scripts can still read the KEK from sessionStorage; for stronger security use a user-derived KEK (e.g. from password).

## Usage

Use `getKeyStorageAdapter()` from `$lib/services/key-storage/index.js`. The identity client uses it for key generation, storage, and signing. Do not read `record[PRIVATE_REF]`; it is for adapter-internal persistence only.
