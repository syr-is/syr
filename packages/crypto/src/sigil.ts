/**
 * Sigil (PIEF) - Prefers WASM when initialized, falls back to TypeScript.
 */

export { createSigil, decryptSigil } from "./wasm-adapter.js";
export type { SigilKdf, SigilEnc, SigilObject } from "./sigil-impl.js";
