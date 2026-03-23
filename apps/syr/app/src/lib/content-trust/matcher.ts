import picomatch from 'picomatch';

export type TrustRuleKind = 'allow' | 'deny';

/** Server-backed rule row (pattern without leading `!`; kind encodes deny vs allow). */
export type TrustRuleRow = {
	/** Absolute URL; path segment may use picomatch glob chars `* ? [ ] { }` for matching. */
	pattern: string;
	kind: TrustRuleKind;
	sort_order: number;
};

export type MatchUrlOptions = {
	/** Current page origin, e.g. `https://app.example.com` */
	pageOrigin: string;
	/** Prefix URLs (e.g. publication registry bases) treated as allow prefixes */
	implicitAllowPrefixes?: string[];
	/** When true, `data:` and `blob:` URLs classify as allowed (still not network loads). */
	allowDataAndBlob?: boolean;
};

function tryParseUrl(href: string, base?: string): URL | null {
	try {
		return new URL(href, base);
	} catch {
		return null;
	}
}

/** Decode path segments; leaves invalid sequences as-is. */
export function normalizePathname(pathname: string): string {
	try {
		return decodeURIComponent(pathname);
	} catch {
		return pathname;
	}
}

function stripTrailingSlash(pathname: string): string {
	let s = pathname;
	while (s.length > 1 && s.endsWith('/')) {
		s = s.slice(0, -1);
	}
	return s;
}

function originsMatch(a: URL, b: URL): boolean {
	return a.origin === b.origin;
}

/** True when pathname uses picomatch glob syntax (not only `*`). */
function pathIsGlob(pathname: string): boolean {
	return /[*?[\]{}]/.test(pathname);
}

function prefixMatch(candidate: URL, pattern: URL): boolean {
	if (!originsMatch(candidate, pattern)) return false;
	const cp = normalizePathname(candidate.pathname);
	const pp = normalizePathname(pattern.pathname);
	if (pp === '/' || pp === '') {
		return true;
	}
	const cpp = stripTrailingSlash(cp);
	const ppp = stripTrailingSlash(pp);
	return cpp === ppp || cpp.startsWith(ppp + '/');
}

/** Max compiled picomatch instances; LRU evicts oldest to cap memory across tenants. */
const GLOB_MATCHER_CACHE_MAX = 128;
const globMatcherOrder: string[] = [];
const compiledGlobMatchers = new Map<string, ReturnType<typeof picomatch>>();

function touchGlobCache(key: string) {
	const i = globMatcherOrder.indexOf(key);
	if (i >= 0) globMatcherOrder.splice(i, 1);
	globMatcherOrder.push(key);
}

function getCompiledGlobMatcher(glob: string) {
	let m = compiledGlobMatchers.get(glob);
	if (m) {
		touchGlobCache(glob);
		return m;
	}
	m = picomatch(glob, { dot: true });
	compiledGlobMatchers.set(glob, m);
	globMatcherOrder.push(glob);
	while (globMatcherOrder.length > GLOB_MATCHER_CACHE_MAX) {
		const evict = globMatcherOrder.shift();
		if (evict) compiledGlobMatchers.delete(evict);
	}
	return m;
}

function globMatch(candidate: URL, pattern: URL): boolean {
	if (!originsMatch(candidate, pattern)) return false;
	const glob = normalizePathname(pattern.pathname);
	const path = normalizePathname(candidate.pathname);
	if (!glob) return true;
	return getCompiledGlobMatcher(glob)(path);
}

function ruleMatches(candidate: URL, patternStr: string): boolean {
	const patternUrl = tryParseUrl(patternStr);
	if (!patternUrl) return false;
	if (pathIsGlob(patternUrl.pathname)) {
		return globMatch(candidate, patternUrl);
	}
	return prefixMatch(candidate, patternUrl);
}

function implicitPrefixMatch(candidate: URL, prefixStr: string): boolean {
	const prefixUrl = tryParseUrl(prefixStr);
	if (!prefixUrl) return false;
	return prefixMatch(candidate, prefixUrl);
}

/**
 * Classify a resource URL against deny/allow rules and built-in same-origin allow.
 * Order: any deny → denied; any allow → allowed; implicit allow prefix → allowed;
 * same-origin → allowed; else unknown.
 */
export function matchUrlAgainstTrustRules(
	href: string,
	rules: TrustRuleRow[],
	options: MatchUrlOptions
): 'allowed' | 'denied' | 'unknown' {
	const u = tryParseUrl(href, options.pageOrigin);
	if (!u) return 'unknown';

	const proto = u.protocol.toLowerCase();
	if (proto === 'data:' || proto === 'blob:') {
		return options.allowDataAndBlob ? 'allowed' : 'unknown';
	}
	if (proto !== 'http:' && proto !== 'https:') {
		return 'unknown';
	}

	const denies = rules.filter((r) => r.kind === 'deny');
	const allows = rules.filter((r) => r.kind === 'allow');

	for (const r of denies) {
		if (ruleMatches(u, r.pattern.trim())) return 'denied';
	}
	for (const r of allows) {
		if (ruleMatches(u, r.pattern.trim())) return 'allowed';
	}
	for (const p of options.implicitAllowPrefixes ?? []) {
		if (implicitPrefixMatch(u, p.trim())) return 'allowed';
	}

	const page = tryParseUrl(options.pageOrigin);
	if (page && u.origin === page.origin) return 'allowed';

	return 'unknown';
}

export function groupUrlsByOrigin(urls: string[]): Map<string, string[]> {
	const map = new Map<string, string[]>();
	for (const raw of urls) {
		const u = tryParseUrl(raw);
		const key = u?.origin ?? '(invalid URL)';
		const list = map.get(key) ?? [];
		list.push(raw);
		map.set(key, list);
	}
	return map;
}
