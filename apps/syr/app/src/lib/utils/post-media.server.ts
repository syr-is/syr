import { recordIdFromDidAndLocal } from '@syr-is/types';
import { uploadController } from '$lib/controllers/upload.controller';

/**
 * Extract upload composite ID (DID + localId) from a media URL.
 * Storage key format: uploads/{did}/[path/]{uploadLocalId}
 * URL format: {endpoint}/{bucket}/uploads/{did}/[path/]{uploadLocalId}
 */
function extractUploadRecordId(url: string): { did: string; localId: string } | null {
	const path = url.split('?')[0].split('#')[0];
	const segments = path.split('/');
	const uploadsIndex = segments.indexOf('uploads');
	if (uploadsIndex < 0 || uploadsIndex + 2 > segments.length) return null;
	const did = segments[uploadsIndex + 1];
	const localId = segments[segments.length - 1];
	if (!did || !localId || did === localId) return null;
	return { did, localId };
}

/** Metadata resolved from upload records for media URLs */
export interface MediaUrlMetadata {
	mimeTypes: Record<string, string>;
	filenames: Record<string, string>;
}

/**
 * Resolve MIME types and filenames for an array of media URLs by looking up each
 * upload record in the database (keyed by the record ID embedded in the URL).
 */
export async function resolveMediaUrlMetadata(
	mediaUrls: string[]
): Promise<MediaUrlMetadata> {
	const mimeTypes: Record<string, string> = {};
	const filenames: Record<string, string> = {};
	await Promise.all(
		mediaUrls.map(async (url) => {
			const ids = extractUploadRecordId(url);
			if (ids) {
				try {
					const recordId = recordIdFromDidAndLocal('upload', ids.did, ids.localId);
					const upload = await uploadController.getUpload(recordId);
					if (upload) {
						mimeTypes[url] = upload.mime_type;
						filenames[url] = upload.filename;
					}
				} catch {
					// Skip if upload record not found
				}
			}
		})
	);
	return { mimeTypes, filenames };
}

/**
 * Resolve MIME types for an array of media URLs.
 * @deprecated Prefer resolveMediaUrlMetadata when filenames are also needed.
 */
export async function resolveMediaUrlMimeTypes(
	mediaUrls: string[]
): Promise<Record<string, string>> {
	const { mimeTypes } = await resolveMediaUrlMetadata(mediaUrls);
	return mimeTypes;
}
