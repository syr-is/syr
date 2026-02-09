import { uploadController } from '$lib/controllers/upload.controller';

/** Extract upload record ID from the last path segment of a media URL */
function extractUploadId(url: string): string | null {
	const path = url.split('?')[0].split('#')[0];
	const segments = path.split('/');
	return segments[segments.length - 1] || null;
}

/**
 * Resolve MIME types for an array of media URLs by looking up each
 * upload record in the database (keyed by the record ID embedded in the URL).
 * Returns a URL -> mime_type map suitable for passing to the client.
 */
export async function resolveMediaUrlMimeTypes(
	mediaUrls: string[]
): Promise<Record<string, string>> {
	const mimeTypes: Record<string, string> = {};
	await Promise.all(
		mediaUrls.map(async (url) => {
			const uploadId = extractUploadId(url);
			if (uploadId) {
				try {
					const upload = await uploadController.getUpload(uploadId);
					if (upload) {
						mimeTypes[url] = upload.mime_type;
					}
				} catch {
					// Skip if upload record not found
				}
			}
		})
	);
	return mimeTypes;
}
