#!/usr/bin/env node
/**
 * Generates an ESM wrapper for the CJS Node WASM build.
 * The wrapper uses createRequire to load the CJS and re-exports all functions,
 * allowing Vite SSR (ESM) to use the Node build without "exports is not defined".
 */

import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");
const outPath = join(pkgRoot, "dist/wasm/node/syr_crypto_wasm_esm.mjs");

const EXPORTS = [
  "build_did_document_wasm",
  "canonicalize_wasm",
  "constant_time_equal_wasm",
  "create_aegis_bundle_wasm",
  "create_rotation_statement_wasm",
  "create_sigil_wasm",
  "decode_multibase_wasm",
  "decode_private_key_wasm",
  "decode_public_key_wasm",
  "decrypt_aegis_bundle_wasm",
  "decrypt_sigil_wasm",
  "derive_did_wasm",
  "ed25519_multicodec_prefix_wasm",
  "ed25519_priv_multicodec_prefix_wasm",
  "encode_multibase_wasm",
  "encode_private_key_wasm",
  "generate_device_keypair_wasm",
  "generate_root_keypair_wasm",
  "is_valid_syr_did_wasm",
  "parse_did_wasm",
  "sign_wasm",
  "verify_rotation_statement_wasm",
  "verify_wasm",
];

const lines = [
  'import { createRequire } from "module";',
  "const require = createRequire(import.meta.url);",
  'const mod = require("./syr_crypto_wasm.js");',
  "",
  ...EXPORTS.map((name) => `export const ${name} = mod.${name};`),
  "",
];

writeFileSync(outPath, lines.join("\n"), "utf8");
console.log("Generated:", outPath);
