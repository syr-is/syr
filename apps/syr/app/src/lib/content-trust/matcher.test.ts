import { describe, expect, it } from 'vitest';
import { matchUrlAgainstTrustRules, normalizePathname, type TrustRuleRow } from './matcher.js';

const pageOrigin = 'https://app.test';

describe('normalizePathname', () => {
	it('decodes percent-encoding', () => {
		expect(normalizePathname('/u%2Falice')).toBe('/u/alice');
	});
});

describe('matchUrlAgainstTrustRules', () => {
	const rules: TrustRuleRow[] = [
		{ pattern: 'https://cdn.example.com/assets', kind: 'allow', sort_order: 0 },
		{ pattern: 'https://evil.example.com', kind: 'deny', sort_order: 1 },
		{ pattern: 'https://syr.test/u/*/public/**', kind: 'allow', sort_order: 2 }
	];

	it('allows same-origin http(s) URLs', () => {
		expect(matchUrlAgainstTrustRules('https://app.test/static/x.png', [], { pageOrigin })).toBe(
			'allowed'
		);
	});

	it('denies before allow', () => {
		const mixed: TrustRuleRow[] = [
			{ pattern: 'https://x.com', kind: 'allow', sort_order: 0 },
			{ pattern: 'https://x.com/bad', kind: 'deny', sort_order: 1 }
		];
		expect(matchUrlAgainstTrustRules('https://x.com/bad/p', mixed, { pageOrigin })).toBe('denied');
		expect(matchUrlAgainstTrustRules('https://x.com/good', mixed, { pageOrigin })).toBe('allowed');
	});

	it('narrow deny overrides broad allow', () => {
		const mixed: TrustRuleRow[] = [
			{ pattern: 'https://s.test/u/alice', kind: 'allow', sort_order: 0 },
			{ pattern: 'https://s.test/u/alice/secret', kind: 'deny', sort_order: 1 }
		];
		expect(matchUrlAgainstTrustRules('https://s.test/u/alice/p', mixed, { pageOrigin })).toBe(
			'allowed'
		);
		expect(matchUrlAgainstTrustRules('https://s.test/u/alice/secret', mixed, { pageOrigin })).toBe(
			'denied'
		);
	});

	it('matches path prefix allows', () => {
		expect(
			matchUrlAgainstTrustRules('https://cdn.example.com/assets/img.png', rules, { pageOrigin })
		).toBe('allowed');
		expect(
			matchUrlAgainstTrustRules('https://cdn.example.com/other/img.png', rules, { pageOrigin })
		).toBe('unknown');
	});

	it('matches glob allows', () => {
		expect(
			matchUrlAgainstTrustRules('https://syr.test/u/bob/public/a/b', rules, { pageOrigin })
		).toBe('allowed');
		expect(
			matchUrlAgainstTrustRules('https://syr.test/u/bob/private/a', rules, { pageOrigin })
		).toBe('unknown');
	});

	it('respects explicit deny list', () => {
		expect(matchUrlAgainstTrustRules('https://evil.example.com/x', rules, { pageOrigin })).toBe(
			'denied'
		);
	});

	it('implicit allow prefixes', () => {
		expect(
			matchUrlAgainstTrustRules('https://reg.io/v1/hosting', [], {
				pageOrigin,
				implicitAllowPrefixes: ['https://reg.io/']
			})
		).toBe('allowed');
	});

	it('classifies data and blob URLs per option', () => {
		expect(
			matchUrlAgainstTrustRules('data:image/png;base64,xxx', [], {
				pageOrigin,
				allowDataAndBlob: false
			})
		).toBe('unknown');
		expect(
			matchUrlAgainstTrustRules('data:image/png;base64,xxx', [], {
				pageOrigin,
				allowDataAndBlob: true
			})
		).toBe('allowed');
	});
});
