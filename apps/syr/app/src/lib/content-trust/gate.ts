import { matchUrlAgainstTrustRules, type MatchUrlOptions, type TrustRuleRow } from './matcher.js';
import type { PostContentConsent } from './consent-storage.js';

export type UrlTrustStatus = 'allowed' | 'denied' | 'unknown';

export function classifyUrls(
	urls: string[],
	rules: TrustRuleRow[],
	options: MatchUrlOptions
): Map<string, UrlTrustStatus> {
	const map = new Map<string, UrlTrustStatus>();
	for (const u of urls) {
		map.set(u, matchUrlAgainstTrustRules(u, rules, options));
	}
	return map;
}

export function canLoadResourceUrl(
	href: string,
	status: UrlTrustStatus,
	ctx: {
		isOwner: boolean;
		consent: PostContentConsent | null;
		contentFingerprint: string;
	}
): boolean {
	if (status === 'denied') return false;
	if (status === 'allowed') return true;
	if (ctx.isOwner) return true;
	if (!ctx.consent || ctx.consent.contentVersion !== ctx.contentFingerprint) return false;
	if (ctx.consent.mode === 'all_for_snapshot') return true;
	if (ctx.consent.mode === 'urls' && ctx.consent.urls?.includes(href)) return true;
	return false;
}

export function allResourcesLoadable(
	urls: string[],
	classification: Map<string, UrlTrustStatus>,
	ctx: {
		isOwner: boolean;
		consent: PostContentConsent | null;
		contentFingerprint: string;
	}
): boolean {
	for (const u of urls) {
		const s = classification.get(u) ?? 'unknown';
		if (!canLoadResourceUrl(u, s, ctx)) return false;
	}
	return true;
}
