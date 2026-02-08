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

/** Returns true only if the URL points to a known browser-viewable type (image, video, or audio) */
export function isViewable(url: string): boolean {
	return isImage(url) || isVideo(url) || isAudio(url);
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

/** Extract a display filename from a URL */
export function getFileName(url: string): string {
	const path = url.split('?')[0].split('#')[0];
	const segments = path.split('/');
	return decodeURIComponent(segments[segments.length - 1] || 'file');
}

/**
 * Client-side album art extraction for audio files.
 * Fetches the audio file, parses ID3/Vorbis/etc tags, and returns a blob URL
 * for the embedded cover image, or null if none found.
 */
const albumArtCache = new Map<string, Promise<string | null>>();

export function fetchAlbumArt(url: string): Promise<string | null> {
	const cached = albumArtCache.get(url);
	if (cached) return cached;

	const promise = (async (): Promise<string | null> => {
		try {
			const { parseWebStream, selectCover } = await import('music-metadata');
			const response = await fetch(url);
			if (!response.ok || !response.body) return null;

			const contentLength = response.headers.get('Content-Length');
			const size = contentLength ? parseInt(contentLength, 10) : undefined;
			const mimeType = response.headers.get('Content-Type') ?? undefined;

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
