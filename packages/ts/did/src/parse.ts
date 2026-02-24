import * as wasm from "@syr-is/crypto/wasm";
import type { ParsedDid } from "./types.js";

/**
 * Parse a did:syr identifier into its components.
 *
 * @param did - The DID string to parse (e.g., "did:syr:z6Mkt9...")
 * @returns The parsed DID with method, id, and decoded public key.
 * @throws If the DID format is invalid, multibase decoding fails,
 *         or the embedded key is not a valid Ed25519 public key.
 *
 * Note: Call initCryptoWasm() from @syr-is/crypto before using this function.
 */
export function parseDid(did: string): ParsedDid {
  try {
    const obj = wasm.parse_did_wasm(did) as Map<string, unknown>;
    const id = obj.get("id") as string;
    const publicKeyArr = obj.get("publicKey") as number[] | Uint8Array;
    return {
      method: "syr",
      id,
      publicKey: new Uint8Array(publicKeyArr),
    };
  } catch (err) {
    throw new Error(String(err), { cause: err });
  }
}
