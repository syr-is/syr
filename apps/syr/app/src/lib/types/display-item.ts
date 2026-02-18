import type { UploadWithCompositeId, Folder } from '@syr-is/types';
import { getMediaType, type MediaType } from '$lib/utils/media';

/**
 * Unified display item type for rendering files and folders
 * across different view modes (list, gallery, masonry, carousel).
 */
export type DisplayItem =
	| { kind: 'folder'; id: string; name: string; isPublic: boolean; data: Folder }
	| {
			kind: 'file';
			id: string;
			url: string;
			filename: string;
			mimeType: string;
			size: number;
			isPublic: boolean;
			status: string;
			createdAt: Date;
			data: UploadWithCompositeId;
	  }
	| { kind: 'media-url'; id: string; url: string; mimeType?: string };

export type ViewMode = 'list' | 'gallery' | 'masonry' | 'carousel';

/** Convert an array of bare URLs (from post media_urls) into DisplayItems */
export function urlsToDisplayItems(
	urls: string[],
	mimeTypes?: Record<string, string>
): DisplayItem[] {
	return urls.map((url, i) => ({
		kind: 'media-url' as const,
		id: `${url}-${i}`,
		url,
		mimeType: mimeTypes?.[url]
	}));
}

/** Convert uploads and folders into DisplayItems (folders first) */
export function uploadsToDisplayItems(
	folders: Folder[],
	uploads: UploadWithCompositeId[]
): DisplayItem[] {
	const folderItems: DisplayItem[] = folders.map((f) => ({
		kind: 'folder' as const,
		id: typeof f.id === 'string' ? f.id : f.id.toString(),
		name: f.name,
		isPublic: f.name.toLowerCase() === 'public',
		data: f
	}));

	const fileItems: DisplayItem[] = uploads.map((u) => ({
		kind: 'file' as const,
		id: typeof u.id === 'string' ? u.id : u.id.toString(),
		url: u.url ?? '',
		filename: u.filename,
		mimeType: u.mime_type,
		size: u.size,
		isPublic: u.is_public,
		status: u.status,
		createdAt: typeof u.created_at === 'string' ? new Date(u.created_at) : u.created_at,
		data: u
	}));

	return [...folderItems, ...fileItems];
}

/** Get the URL for a DisplayItem (returns empty string for folders) */
export function getItemUrl(item: DisplayItem): string {
	if (item.kind === 'folder') return '';
	if (item.kind === 'file') return item.url;
	return item.url;
}

/** Get the display filename for a DisplayItem */
export function getItemFilename(item: DisplayItem): string {
	if (item.kind === 'folder') return item.name;
	if (item.kind === 'file') return item.filename;
	// For media-url, extract from URL
	const path = item.url.split('?')[0].split('#')[0];
	const segments = path.split('/');
	return decodeURIComponent(segments[segments.length - 1] || 'file');
}

/** Get MIME type for a DisplayItem when available */
export function getItemMimeType(item: DisplayItem): string | undefined {
	if (item.kind === 'folder') return undefined;
	if (item.kind === 'file') return item.mimeType;
	return item.mimeType;
}

/** Determine the media type for a DisplayItem using mime type when available, URL extension as fallback */
export function getItemMediaType(item: DisplayItem): MediaType {
	if (item.kind === 'folder') return 'other';
	if (item.kind === 'file') return getMediaType(item.url, item.mimeType);
	return getMediaType(item.url, item.mimeType);
}

/** Extract only file/media-url items (no folders) */
export function getFileItems(items: DisplayItem[]): DisplayItem[] {
	return items.filter((item) => item.kind !== 'folder');
}

/** Check if a media type is viewable (image, video, audio, or pdf) */
export function isItemViewable(item: DisplayItem): boolean {
	const mt = getItemMediaType(item);
	return mt === 'image' || mt === 'video' || mt === 'audio' || mt === 'pdf';
}

/**
 * Resolve a usable download/preview URL for a DisplayItem.
 * - 'media-url' items already have a resolved URL, returned immediately.
 * - 'file' items need a signed URL fetched from the uploads API.
 * - 'folder' items return null (not previewable).
 */
export async function resolveItemUrl(
	item: DisplayItem
): Promise<{ url: string; isPublic: boolean } | null> {
	if (item.kind === 'folder') return null;
	if (item.kind === 'media-url') return { url: item.url, isPublic: true };
	// kind === 'file' — fetch a signed download URL via the API
	try {
		const uploadUrl =
			item.data.did && item.data.local_id
				? `/api/uploads/${item.data.did}/${item.data.local_id}`
				: `/api/uploads/${item.id}`;
		const response = await fetch(uploadUrl);
		if (!response.ok) return null;
		const result = await response.json();
		const url = result.data?.downloadUrl;
		if (!url) return null;
		return {
			url,
			isPublic: result.data?.isPublic ?? item.isPublic
		};
	} catch {
		return null;
	}
}
