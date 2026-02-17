/**
 * Canonicalize a JSON object using RFC 8785 JSON Canonicalization Scheme (JCS).
 * Uses the battle-tested `canonicalize` package for consistent output across
 * environments (string encoding, number formatting) and robust spec compliance.
 *
 * @param obj - The object to canonicalize.
 * @returns The canonical JSON string.
 * @throws If the object cannot be serialized (e.g. NaN, Infinity, unsupported types).
 */
import canon from "canonicalize";

type CanonicalizeFn = (input: unknown) => string | undefined;

export function canonicalize(obj: Record<string, unknown>): string {
  const result = (canon as unknown as CanonicalizeFn)(obj);
  if (result === undefined) {
    throw new Error("Canonicalize returned undefined");
  }
  return result;
}
