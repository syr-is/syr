/**
 * Dev origin utilities: IP filter for LAN patterns when NODE_ENV=development.
 * Allows 10.x.x.x, 172.16-31.x.x, 192.168.x.x, localhost, 127.0.0.1 per RFC 1918.
 */

/** RFC 1918 private ranges + localhost. Only used when nodeEnv === 'development'. */
const DEV_LAN_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/, // 172.16.0.0/12
  /^192\.168\.\d{1,3}\.\d{1,3}$/, // 192.168.0.0/16
  /^localhost$/i,
  /^127\.0\.0\.1$/,
];

function isDevLanHost(host: string): boolean {
  return DEV_LAN_PATTERNS.some((re) => re.test(host));
}

/**
 * Normalize origin to scheme + host + port (no path/query).
 */
function normalizeOrigin(url: string): string {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return url;
  }
}

/**
 * Check if origin is allowed. In development, also allows RFC 1918 LAN hosts (10.x, 172.16-31.x, 192.168.x) and localhost.
 *
 * @param origin - The Origin header value
 * @param allowedOrigins - Explicit list of allowed origins (from ALLOWED_ORIGINS or [PUBLIC_URL])
 * @param nodeEnv - NODE_ENV; LAN matching only when 'development'
 */
export function isOriginAllowed(
  origin: string,
  allowedOrigins: readonly string[],
  nodeEnv: string,
): boolean {
  const normalized = normalizeOrigin(origin);

  // Explicit match
  if (allowedOrigins.some((a) => a === normalized)) {
    return true;
  }

  // In development, allow LAN patterns
  if (nodeEnv === "development") {
    try {
      const u = new URL(normalized);
      if (isDevLanHost(u.hostname)) {
        return true;
      }
    } catch {
      // ignore invalid URLs
    }
  }

  return false;
}
