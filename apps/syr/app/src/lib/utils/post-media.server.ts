// AI Provenance: AI-assisted imports (Gemini) for batch query optimization
import { recordIdFromDidAndLocal } from '@syr-is/types';
import { uploadRepository } from '$lib/repositories/upload.repository';
import type { RecordId } from 'surrealdb';

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
export async function resolveMediaUrlMetadata(mediaUrls: string[]): Promise<MediaUrlMetadata> {
	const mimeTypes: Record<string, string> = {};
	const filenames: Record<string, string> = {};
	
	const uniqueUrls = [...new Set(mediaUrls)];
	const recordIds: RecordId[] = [];
	const urlByRecordId = new Map<string, string[]>();

	for (const url of uniqueUrls) {
		const ids = extractUploadRecordId(url);
		if (ids) {
			const recordId = recordIdFromDidAndLocal('upload', ids.did, ids.localId);
			const ridStr = recordId.toString();
			
			const urls = urlByRecordId.get(ridStr) || [];
			if (urls.length === 0) {
				recordIds.push(recordId);
			}
			urls.push(url);
			urlByRecordId.set(ridStr, urls);
		}
	}

	if (recordIds.length > 0) {
		// AI Provenance: AI-generated code (Gemini)
		// Context: Resolving media metadata in a single batch query to avoid N+1 lookups.
		// Limitations/Assumptions: If the entire batch query fails, the error is caught and metadata won't be populated for any URLs. Invalid individual uploads are handled upstream in \`findByIds\`.
		try {
			const uploads = await uploadRepository.findByIds(recordIds);
			for (const upload of uploads) {
				const ridStr = upload.id.toString();
				const mappedUrls = urlByRecordId.get(ridStr);
				if (mappedUrls) {
					for (const url of mappedUrls) {
						mimeTypes[url] = upload.mime_type;
						filenames[url] = upload.filename;
					}
				}
			}
		} catch {
			// Skip if batch query fails
		}
	}

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
