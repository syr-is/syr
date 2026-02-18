/**
 * Browser stub for @syr-is/crypto/pem.
 * PEM export/import requires Node.js crypto (createPrivateKey).
 * Import this subpath only from server-side code (e.g. SvelteKit API routes).
 */

const REQUIRES_NODE =
  "@syr-is/crypto/pem requires Node.js. Import only from server-side code (e.g. SvelteKit +server.ts).";

export function exportPrivateKeyToEncryptedPem(
  _multibasePrivateKey: string,
  _passphrase: string,
): string {
  throw new Error(REQUIRES_NODE);
}

export function importPrivateKeyFromEncryptedPem(
  _pem: string,
  _passphrase: string,
): string {
  throw new Error(REQUIRES_NODE);
}

export function encodeDerLength(_len: number): never {
  throw new Error(REQUIRES_NODE);
}

export function rawToPkcs8Der(_raw: Uint8Array): never {
  throw new Error(REQUIRES_NODE);
}

export function extractRawKeyFromPkcs8(_der: ArrayBuffer | Uint8Array): never {
  throw new Error(REQUIRES_NODE);
}
