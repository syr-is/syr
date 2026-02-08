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

/** Accepted MIME type prefixes for media uploads */
const ACCEPTED_MEDIA_MIME_PREFIXES = ['image/', 'video/'];

/** Check whether a File has an accepted media MIME type for upload */
export function isAcceptedMediaFile(file: File): boolean {
	return ACCEPTED_MEDIA_MIME_PREFIXES.some((prefix) => file.type.startsWith(prefix));
}
