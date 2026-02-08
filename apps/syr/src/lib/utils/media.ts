/**
 * Shared media type detection utilities.
 * Centralizes extension-based checks used across media-viewer, new-post, edit page, and post-preview.
 */

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'];

/** Strip query string and fragment, then return the lowercased path portion of a URL */
function urlPath(url: string): string {
	return url.split('?')[0].split('#')[0].toLowerCase();
}

export function isVideo(url: string): boolean {
	const path = urlPath(url);
	return VIDEO_EXTENSIONS.some((ext) => path.endsWith(ext));
}

export function isImage(url: string): boolean {
	const path = urlPath(url);
	return IMAGE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

export function isAudio(url: string): boolean {
	const path = urlPath(url);
	return AUDIO_EXTENSIONS.some((ext) => path.endsWith(ext));
}

export type MediaType = 'image' | 'video' | 'audio' | 'other';

/**
 * Determine the media type of a file.
 * Prefers mime type when available (accurate for uploads), falls back to URL extension checks.
 */
export function getMediaType(url: string, mimeType?: string): MediaType {
	if (mimeType) {
		if (mimeType.startsWith('image/')) return 'image';
		if (mimeType.startsWith('video/')) return 'video';
		if (mimeType.startsWith('audio/')) return 'audio';
		return 'other';
	}
	if (isImage(url)) return 'image';
	if (isVideo(url)) return 'video';
	if (isAudio(url)) return 'audio';
	return 'other';
}

/** Parse a string as a positive integer, returning undefined if invalid */
function safeParsePositiveInt(value: string | null | undefined): number | undefined {
	if (!value) return undefined;
	const n = parseInt(value, 10);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Client-side album art extraction for audio files.
 * Uses a Range request to fetch only the first chunk of the file (where ID3/metadata
 * tags live) instead of downloading the entire audio file.
 */
const albumArtCache = new Map<string, Promise<string | null>>();

/** Max file size (in bytes) to attempt album art extraction from. Default 200 MB. */
const ALBUM_ART_MAX_FILE_SIZE = 200 * 1024 * 1024;
/** How many bytes to request via Range header. 256 KB covers most embedded artwork. */
const ALBUM_ART_RANGE_BYTES = 256 * 1024;

export function fetchAlbumArt(url: string): Promise<string | null> {
	const cached = albumArtCache.get(url);
	if (cached) return cached;

	const promise = (async (): Promise<string | null> => {
		try {
			const { parseWebStream, selectCover } = await import('music-metadata');

			// Probe file size with HEAD to skip very large files
			let totalSize: number | undefined;
			let mimeType: string | undefined;
			try {
				const head = await fetch(url, { method: 'HEAD' });
				if (head.ok) {
					totalSize = safeParsePositiveInt(head.headers.get('Content-Length'));
					mimeType = head.headers.get('Content-Type') ?? undefined;
					if (totalSize && totalSize > ALBUM_ART_MAX_FILE_SIZE) return null;
				}
			} catch {
				// HEAD not supported or failed — continue with Range/full fetch
			}

			// Try a Range request for just the first chunk
			const rangeHeader = `bytes=0-${ALBUM_ART_RANGE_BYTES - 1}`;
			const response = await fetch(url, {
				headers: { Range: rangeHeader }
			});

			if (!response.ok || !response.body) return null;

			// Determine actual size the parser should see
			let size: number | undefined;
			if (response.status === 206) {
				// Server honored the Range — tell the parser the full file size if known
				size = totalSize;
			} else {
				// Server returned the full file (200 OK); use Content-Length
				size = safeParsePositiveInt(response.headers.get('Content-Length')) ?? totalSize;
			}

			if (!mimeType) {
				mimeType = response.headers.get('Content-Type') ?? undefined;
			}

			const metadata = await parseWebStream(response.body, { mimeType, size });
			const cover = selectCover(metadata.common.picture);
			if (!cover) return null;

			const blob = new Blob([new Uint8Array(cover.data)], { type: cover.format });
			return URL.createObjectURL(blob);
		} catch {
			return null;
		}
	})();

	albumArtCache.set(url, promise);
	return promise;
}
