import { marked } from 'marked';
import type { Config } from 'dompurify';

const ALLOWED_TAGS = [
	'p',
	'br',
	'strong',
	'em',
	'b',
	'i',
	'u',
	's',
	'del',
	'ins',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'ul',
	'ol',
	'li',
	'blockquote',
	'code',
	'pre',
	'a',
	'img',
	'table',
	'thead',
	'tbody',
	'tr',
	'th',
	'td',
	'hr',
	'span',
	'div',
	'sub',
	'sup'
];

const ALLOWED_ATTR = [
	'href',
	'src',
	'alt',
	'title',
	'class',
	'colspan',
	'rowspan',
	'width',
	'height',
	'loading'
];

function domPurifyConfig(allowDataUrls: boolean): Config {
	return {
		ALLOWED_TAGS,
		ALLOWED_ATTR,
		ALLOW_DATA_ATTR: false,
		ALLOWED_URI_REGEXP: allowDataUrls
			? /^(?:(?:https?|mailto|data|blob):|\/)/i
			: /^(?:(?:https?|mailto):|\/)/i
	};
}

async function loadPurify() {
	if (typeof window === 'undefined') return null;
	const { default: DOMPurify } = await import('dompurify');
	return DOMPurify;
}

export async function sanitizePostHtmlFragment(
	html: string,
	allowDataUrls = false
): Promise<string> {
	const DOMPurify = await loadPurify();
	if (!DOMPurify) return '';
	return DOMPurify.sanitize(html, domPurifyConfig(allowDataUrls));
}

export async function sanitizeMarkdownToHtml(
	markdown: string,
	allowDataUrls = false
): Promise<string> {
	const raw = await marked.parse(markdown, { gfm: true, breaks: true });
	const html = typeof raw === 'string' ? raw : String(raw ?? '');
	return sanitizePostHtmlFragment(html, allowDataUrls);
}

/** Plain text from already-sanitized HTML (safe mode: no remote subresources in the DOM tree). */
export function sanitizedHtmlToPlainText(safeHtml: string): string {
	if (typeof document === 'undefined') return '';
	const d = new DOMParser().parseFromString(safeHtml, 'text/html');
	return d.body?.textContent?.trim() ?? '';
}
