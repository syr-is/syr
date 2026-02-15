/**
 * Canonicalize a JSON object using RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * Properties:
 * - Lexicographically sorted object keys
 * - Compact JSON (no insignificant whitespace)
 * - UTF-8 encoding
 * - No trailing newline
 * - Deterministic number formatting per RFC 8785
 *
 * @param obj - The object to canonicalize.
 * @returns The canonical JSON string.
 * @throws If the object cannot be serialized.
 */
export function canonicalize(obj: Record<string, unknown>): string {
  // Implement JCS (RFC 8785) directly to avoid CJS import issues with `canonicalize` package.
  // JCS is simply: JSON.stringify with keys sorted lexicographically at each level.
  return jcsStringify(obj);
}

function jcsStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (!isFinite(value)) {
      throw new Error("Infinity is not allowed in JCS");
    }
    if (Number.isNaN(value)) {
      throw new Error("NaN is not allowed in JCS");
    }
    // ES6 number serialization per RFC 8785
    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const elements = value.map((el) => jcsStringify(el));
    return "[" + elements.join(",") + "]";
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const pairs = keys
      .filter((key) => obj[key] !== undefined)
      .map((key) => JSON.stringify(key) + ":" + jcsStringify(obj[key]));
    return "{" + pairs.join(",") + "}";
  }

  throw new Error(`Unsupported type for JCS: ${typeof value}`);
}
