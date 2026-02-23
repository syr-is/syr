/**
 * Aegis (CIGP) - Prefers WASM when initialized, falls back to TypeScript.
 */

export { createAegisBundle, decryptAegisBundle } from "./wasm-adapter.js";
export type { AegisKdfParams, AegisBundle } from "./aegis-impl.js";
