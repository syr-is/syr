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
 *
 * The cache is bounded (LRU): when it exceeds ALBUM_ART_CACHE_MAX entries the
 * oldest blob URLs are revoked and their entries dropped, preventing unbounded
 * memory growth during long browsing sessions.
 */

/** Max file size (in bytes) to attempt album art extraction from. Default 200 MB. */
const ALBUM_ART_MAX_FILE_SIZE = 200 * 1024 * 1024;
/** How many bytes to request via Range header. 256 KB covers most embedded artwork. */
const ALBUM_ART_RANGE_BYTES = 256 * 1024;
/** Maximum number of album art blob URLs to keep in memory. */
const ALBUM_ART_CACHE_MAX = 50;

/**
 * LRU cache for album art blob URLs.
 * Keys are audio file URLs; values are promises that resolve to a blob URL or null.
 * Map iteration order (insertion order) is used as the eviction order — on every
 * cache hit the entry is moved to the end so the least-recently-used entries are
 * at the front.
 *
 * Visibility tracking via IntersectionObserver ensures entries whose album art
 * is currently rendered on-screen are never evicted. Only off-screen, least-
 * recently-used entries are candidates for eviction.
 */
const albumArtCache = new Map<string, Promise<string | null>>();

// ---------------------------------------------------------------------------
// Visibility tracking
// ---------------------------------------------------------------------------

/**
 * Maps audio URL -> set of DOM elements currently rendering its album art.
 * When the set is non-empty the URL is considered "visible" and protected
 * from eviction.
 */
const visibleElements = new Map<string, Set<Element>>();

/** Reverse lookup: element -> audio URL it's tracking. */
const elementToUrl = new WeakMap<Element, string>();

/** Shared IntersectionObserver (created lazily, client-side only). */
let observer: IntersectionObserver | null = null;

function getObserver(): IntersectionObserver {
	if (!observer) {
		observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const url = elementToUrl.get(entry.target);
					if (!url) continue;
					const elSet = visibleElements.get(url);
					if (!elSet) continue;
					if (entry.isIntersecting) {
						elSet.add(entry.target);
					} else {
						elSet.delete(entry.target);
						if (elSet.size === 0) visibleElements.delete(url);
					}
				}
				// Opportunistically trim when things scroll off-screen
				trimAlbumArtCache();
			},
			{ rootMargin: '200px' } // keep a buffer so art near the viewport isn't evicted
		);
	}
	return observer;
}

/** Check whether any on-screen element is showing art for this URL. */
function isAlbumArtVisible(url: string): boolean {
	const elSet = visibleElements.get(url);
	return !!elSet && elSet.size > 0;
}

/**
 * Svelte action: attach to the DOM element that displays album art for a
 * given audio URL. Tracks visibility via IntersectionObserver so the cache
 * knows which blob URLs are on-screen.
 *
 * Usage: `<div use:trackAlbumArt={audioUrl}>...</div>`
 */
export function trackAlbumArt(node: Element, url: string) {
	function observe(u: string) {
		if (!u) return;
		elementToUrl.set(node, u);
		let elSet = visibleElements.get(u);
		if (!elSet) {
			elSet = new Set();
			visibleElements.set(u, elSet);
		}
		elSet.add(node); // assume visible until observer says otherwise
		getObserver().observe(node);
	}

	function unobserve() {
		const prevUrl = elementToUrl.get(node);
		if (prevUrl) {
			const elSet = visibleElements.get(prevUrl);
			if (elSet) {
				elSet.delete(node);
				if (elSet.size === 0) visibleElements.delete(prevUrl);
			}
		}
		getObserver().unobserve(node);
	}

	observe(url);

	return {
		update(newUrl: string) {
			unobserve();
			observe(newUrl);
		},
		destroy() {
			unobserve();
			trimAlbumArtCache();
		}
	};
}

// ---------------------------------------------------------------------------
// Eviction helpers
// ---------------------------------------------------------------------------

/** Revoke a resolved blob URL and remove the entry from the cache. */
function evictAlbumArt(key: string) {
	const entry = albumArtCache.get(key);
	if (!entry) return;
	albumArtCache.delete(key);
	// Revoke asynchronously — the promise may still be pending
	entry.then((blobUrl) => {
		if (blobUrl) URL.revokeObjectURL(blobUrl);
	}).catch(() => {});
}

/** Trim the cache to ALBUM_ART_CACHE_MAX by evicting oldest off-screen entries. */
function trimAlbumArtCache() {
	if (albumArtCache.size <= ALBUM_ART_CACHE_MAX) return;

	// Collect eviction candidates: entries not currently visible, oldest first
	for (const key of albumArtCache.keys()) {
		if (albumArtCache.size <= ALBUM_ART_CACHE_MAX) break;
		if (!isAlbumArtVisible(key)) {
			evictAlbumArt(key);
		}
	}
}

export function fetchAlbumArt(url: string): Promise<string | null> {
	const cached = albumArtCache.get(url);
	if (cached) {
		// Move to end (most-recently-used) by re-inserting
		albumArtCache.delete(url);
		albumArtCache.set(url, cached);
		return cached;
	}

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
	trimAlbumArtCache();
	return promise;
}
