/** Default max post payload (decoded estimate) when user has not set a preference. */
export const DEFAULT_MAX_POST_PAYLOAD_BYTES = 2 * 1024 * 1024;

/** PATCH /api/user/content-limits bounds. */
export const MIN_MAX_POST_PAYLOAD_BYTES = 64 * 1024;
export const MAX_MAX_POST_PAYLOAD_BYTES = 50 * 1024 * 1024;

/** Hard cap on raw JSON response size before parse (list or single), to avoid huge arrayBuffers. */
export const MAX_JSON_RESPONSE_BYTES = 50 * 1024 * 1024;

export function effectiveMaxPostPayloadBytes(userValue: number | null | undefined): number {
	if (
		userValue != null &&
		userValue >= MIN_MAX_POST_PAYLOAD_BYTES &&
		userValue <= MAX_MAX_POST_PAYLOAD_BYTES
	) {
		return userValue;
	}
	return DEFAULT_MAX_POST_PAYLOAD_BYTES;
}
