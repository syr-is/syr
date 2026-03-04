/**
 * @syr-is/utils
 * Common utilities: origin/IP filtering for dev LAN access,
 * context-aware crypto (SHA-256 via crypto.subtle or @noble/hashes).
 */

export { isOriginAllowed } from "./origins.js";
export { computeSha256Hex } from "./crypto.js";
