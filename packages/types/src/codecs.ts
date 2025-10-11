import { z } from "zod";

/**
 * Zod Codecs
 * Bi-directional transformations for data serialization/deserialization
 * Based on Zod v4 codec patterns: https://zod.dev/codecs
 */

/**
 * String to Number Codec
 * Converts string representations of numbers to JavaScript number type
 */
export const stringToNumber = z.codec(z.string(), z.number(), {
  decode: (str) => Number(str),
  encode: (num) => num.toString(),
});

/**
 * String to Integer Codec
 * Converts string representations of integers to JavaScript number type
 */
export const stringToInt = z.codec(z.string().regex(/^-?\d+$/), z.int(), {
  decode: (str) => Number.parseInt(str, 10),
  encode: (num) => num.toString(),
});

/**
 * String to BigInt Codec
 * Converts string representations to JavaScript bigint type
 */
export const stringToBigInt = z.codec(z.string(), z.bigint(), {
  decode: (str) => BigInt(str),
  encode: (bigint) => bigint.toString(),
});

/**
 * Number to BigInt Codec
 * Converts JavaScript number to bigint type
 */
export const numberToBigInt = z.codec(z.int(), z.bigint(), {
  decode: (num) => BigInt(num),
  encode: (bigint) => Number(bigint),
});

/**
 * ISO Datetime to Date Codec
 * Converts ISO datetime strings to JavaScript Date objects
 * This is the primary codec for handling dates in the SYR platform
 */
export const isoDatetimeToDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (isoString) => new Date(isoString),
  encode: (date) => date.toISOString(),
});

/**
 * Epoch Seconds to Date Codec
 * Converts Unix timestamps (seconds since epoch) to JavaScript Date objects
 */
export const epochSecondsToDate = z.codec(z.int().min(0), z.date(), {
  decode: (seconds) => new Date(seconds * 1000),
  encode: (date) => Math.floor(date.getTime() / 1000),
});

/**
 * Epoch Milliseconds to Date Codec
 * Converts Unix timestamps (milliseconds since epoch) to JavaScript Date objects
 */
export const epochMillisToDate = z.codec(z.int().min(0), z.date(), {
  decode: (millis) => new Date(millis),
  encode: (date) => date.getTime(),
});

/**
 * JSON Codec Factory
 * Parses JSON strings into structured data and serializes back to JSON
 * @param schema - Zod schema to validate parsed JSON data
 */
export const json = <T extends z.ZodTypeAny>(schema: T) =>
  z.codec(z.string(), schema, {
    decode: (jsonString) => {
      try {
        return JSON.parse(jsonString);
      } catch (err: any) {
        throw new Error(`Invalid JSON: ${err.message}`);
      }
    },
    encode: (value) => JSON.stringify(value),
  });

/**
 * UTF-8 to Bytes Codec
 * Converts UTF-8 strings to Uint8Array byte arrays
 */
export const utf8ToBytes = z.codec(z.string(), z.instanceof(Uint8Array), {
  decode: (str) => new TextEncoder().encode(str),
  encode: (bytes) => new TextDecoder().decode(bytes),
});

/**
 * Bytes to UTF-8 Codec
 * Converts Uint8Array byte arrays to UTF-8 strings
 */
export const bytesToUtf8 = z.codec(z.instanceof(Uint8Array), z.string(), {
  decode: (bytes) => new TextDecoder().decode(bytes),
  encode: (str) => new TextEncoder().encode(str),
});

/**
 * Base64 to Bytes Codec
 * Converts base64 strings to Uint8Array byte arrays
 */
export const base64ToBytes = z.codec(z.base64(), z.instanceof(Uint8Array), {
  decode: (base64String) => {
    const binaryString = atob(base64String);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  },
  encode: (bytes) => {
    let binaryString = "";
    for (let i = 0; i < bytes.length; i++) {
      binaryString += String.fromCharCode(bytes[i]);
    }
    return btoa(binaryString);
  },
});

/**
 * Base64 URL to Bytes Codec
 * Converts base64url strings (URL-safe base64) to Uint8Array
 */
export const base64urlToBytes = z.codec(
  z.base64url(),
  z.instanceof(Uint8Array),
  {
    decode: (base64urlString) => {
      // Convert base64url to base64
      const base64 = base64urlString.replace(/-/g, "+").replace(/_/g, "/");
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    },
    encode: (bytes) => {
      let binaryString = "";
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i]);
      }
      return btoa(binaryString)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
    },
  }
);

/**
 * Hex to Bytes Codec
 * Converts hexadecimal strings to Uint8Array byte arrays
 */
export const hexToBytes = z.codec(z.hex(), z.instanceof(Uint8Array), {
  decode: (hexString) => {
    const bytes = new Uint8Array(hexString.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hexString.substr(i * 2, 2), 16);
    }
    return bytes;
  },
  encode: (bytes) => {
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  },
});

/**
 * String to URL Codec
 * Converts URL strings to JavaScript URL objects
 */
export const stringToURL = z.codec(z.url(), z.instanceof(URL), {
  decode: (urlString) => new URL(urlString),
  encode: (url) => url.href,
});

/**
 * String to HTTP URL Codec
 * Converts HTTP/HTTPS URL strings to JavaScript URL objects
 */
export const stringToHttpURL = z.codec(z.httpUrl(), z.instanceof(URL), {
  decode: (urlString) => new URL(urlString),
  encode: (url) => url.href,
});

/**
 * URI Component Codec
 * Encodes and decodes URI components
 */
export const uriComponent = z.codec(z.string(), z.string(), {
  decode: (encodedString) => decodeURIComponent(encodedString),
  encode: (decodedString) => encodeURIComponent(decodedString),
});

/**
 * Boolean String Codec
 * Converts "true"/"false" strings to boolean
 */
export const stringToBoolean = z.codec(z.enum(["true", "false"]), z.boolean(), {
  decode: (str) => str === "true",
  encode: (bool) => (bool ? "true" : "false"),
});

/**
 * Nullable Codec
 * Converts null to undefined and vice versa
 */
export const nullToUndefined = z.codec(z.null(), z.undefined(), {
  decode: () => undefined,
  encode: () => null,
});
