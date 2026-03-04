import { sha256 } from "@noble/hashes/sha256";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compute SHA-256 hash of data and return as lowercase hex string.
 * Uses Web Crypto API when available (secure contexts: HTTPS, localhost),
 * falls back to @noble/hashes when crypto.subtle is undefined (e.g. HTTP on LAN IP).
 */
export async function computeSha256Hex(data: ArrayBuffer): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return bytesToHex(new Uint8Array(hashBuffer));
  }
  const hash = sha256(new Uint8Array(data));
  return bytesToHex(hash);
}
