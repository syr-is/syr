/**
 * Collect URLs that may trigger network loads from an HTML fragment (pre-sanitize).
 * Requires DOMParser (browser or happy-dom in tests).
 */
export function extractSubresourceUrlsFromHtml(html: string, baseHref?: string): string[] {
	const found = new Set<string>();
	if (!html?.trim()) return [];

	const doc = new DOMParser().parseFromString(html, 'text/html');
	const base = baseHref ?? 'https://invalid.local/';

	const pushUrl = (raw: string | null | undefined) => {
		if (!raw) return;
		const t = raw.trim();
		if (!t || t.startsWith('#')) return;
		try {
			found.add(new URL(t, base).href);
		} catch {
			// ignore
		}
	};

	const splitSrcset = (srcset: string) => {
		for (const part of srcset.split(',')) {
			const url = part.trim().split(/\s+/)[0];
			pushUrl(url);
		}
	};

	for (const el of doc.querySelectorAll('img[src]')) {
		pushUrl(el.getAttribute('src'));
	}
	for (const el of doc.querySelectorAll('img[srcset]')) {
		splitSrcset(el.getAttribute('srcset') ?? '');
	}
	for (const el of doc.querySelectorAll('source[src], source[srcset]')) {
		pushUrl(el.getAttribute('src'));
		const ss = el.getAttribute('srcset');
		if (ss) splitSrcset(ss);
	}
	for (const sel of ['video[src]', 'audio[src]', 'track[src]', 'iframe[src]', 'embed[src]']) {
		for (const el of doc.querySelectorAll(sel)) {
			pushUrl(el.getAttribute('src'));
		}
	}
	for (const el of doc.querySelectorAll('object[data]')) {
		pushUrl(el.getAttribute('data'));
	}
	for (const el of doc.querySelectorAll('link[href]')) {
		const rel = (el.getAttribute('rel') ?? '').toLowerCase();
		if (rel.includes('stylesheet') || rel.includes('preload')) {
			pushUrl(el.getAttribute('href'));
		}
	}
	for (const el of doc.querySelectorAll('image[href], use[href], image, use')) {
		const href = el.getAttribute('href');
		const xlink =
			href?.trim() ||
			el.getAttribute('xlink:href') ||
			el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
		pushUrl(xlink);
	}

	for (const el of doc.querySelectorAll('[style]')) {
		const style = el.getAttribute('style') ?? '';
		const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
		let m: RegExpExecArray | null;
		while ((m = re.exec(style)) !== null) {
			pushUrl(m[2]?.trim());
		}
	}

	return [...found];
}
