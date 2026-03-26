import { describe, it, expect } from 'vitest';
import {
	IdentityInitRequestSchema,
	DelegationStatementSchema,
	IdentityExportBundleSchema,
	DelegationScopeSchema
} from '../identity.js';
import { DidSyrSchema } from '../common.js';

const VALID_DID = 'did:syr:z6MkhaXgBZDvotDkL5LQ48B2Pz2KkJHNQwmfArFBkWYprLi3';
const VALID_MULTIBASE = 'z6MkhaXgBZDvotDkL5LQ48B2Pz2KkJHNQwmfArFBkWYprLi3';
const VALID_TIMESTAMP = '2025-01-01T00:00:00.000Z';

describe('DidSyrSchema', () => {
	it('accepts valid did:syr identifiers', () => {
		expect(DidSyrSchema.parse(VALID_DID)).toBe(VALID_DID);
	});

	it('rejects did:web', () => {
		expect(() => DidSyrSchema.parse('did:web:example.com')).toThrow();
	});

	it('rejects empty string', () => {
		expect(() => DidSyrSchema.parse('')).toThrow();
	});

	it('rejects non-multibase identifier', () => {
		expect(() => DidSyrSchema.parse('did:syr:abc123')).toThrow();
	});
});

describe('DelegationScopeSchema', () => {
	it("accepts 'device'", () => {
		expect(DelegationScopeSchema.parse('device')).toBe('device');
	});

	it("accepts 'session'", () => {
		expect(DelegationScopeSchema.parse('session')).toBe('session');
	});

	it('rejects invalid scope', () => {
		expect(() => DelegationScopeSchema.parse('admin')).toThrow();
	});
});

describe('DelegationStatementSchema', () => {
	it('validates a complete delegation statement', () => {
		const result = DelegationStatementSchema.parse({
			did: VALID_DID,
			delegate: VALID_MULTIBASE,
			scope: 'device',
			createdAt: VALID_TIMESTAMP
		});
		expect(result.did).toBe(VALID_DID);
		expect(result.scope).toBe('device');
	});

	it('accepts optional expiresAt', () => {
		const result = DelegationStatementSchema.parse({
			did: VALID_DID,
			delegate: VALID_MULTIBASE,
			scope: 'device',
			createdAt: VALID_TIMESTAMP,
			expiresAt: '2026-01-01T00:00:00.000Z'
		});
		expect(result.expiresAt).toBe('2026-01-01T00:00:00.000Z');
	});

	it('rejects missing delegate', () => {
		expect(() =>
			DelegationStatementSchema.parse({
				did: VALID_DID,
				scope: 'device',
				createdAt: VALID_TIMESTAMP
			})
		).toThrow();
	});
});

describe('IdentityInitRequestSchema', () => {
	const validRequest = {
		did: VALID_DID,
		publicKey: VALID_MULTIBASE,
		devicePublicKey: VALID_MULTIBASE,
		delegation: {
			did: VALID_DID,
			delegate: VALID_MULTIBASE,
			scope: 'device' as const,
			createdAt: VALID_TIMESTAMP,
			signature: VALID_MULTIBASE
		}
	};

	it('accepts a valid init request', () => {
		const result = IdentityInitRequestSchema.parse(validRequest);
		expect(result.did).toBe(VALID_DID);
	});

	it('rejects missing publicKey', () => {
		const { publicKey: _publicKey, ...rest } = validRequest;
		expect(() => IdentityInitRequestSchema.parse(rest)).toThrow();
	});

	it('rejects missing delegation', () => {
		const { delegation: _delegation, ...rest } = validRequest;
		expect(() => IdentityInitRequestSchema.parse(rest)).toThrow();
	});

	it('rejects invalid DID format', () => {
		expect(() =>
			IdentityInitRequestSchema.parse({ ...validRequest, did: 'did:web:bad' })
		).toThrow();
	});
});

describe('IdentityExportBundleSchema', () => {
	const validBundle = {
		did: VALID_DID,
		publicKey: VALID_MULTIBASE,
		didDocument: { id: VALID_DID },
		delegatedKeys: [
			{
				publicKey: VALID_MULTIBASE,
				scope: 'device' as const,
				createdAt: VALID_TIMESTAMP,
				signature: VALID_MULTIBASE
			}
		],
		profile: {
			displayName: 'Alice'
		},
		exportedAt: VALID_TIMESTAMP
	};

	it('accepts a valid export bundle', () => {
		const result = IdentityExportBundleSchema.parse(validBundle);
		expect(result.did).toBe(VALID_DID);
		expect(result.delegatedKeys).toHaveLength(1);
	});

	it('accepts optional profile fields', () => {
		const bundle = {
			...validBundle,
			profile: {
				displayName: 'Alice',
				bio: 'Hello',
				avatarUrl: 'https://example.com/avatar.png',
				bannerUrl: 'https://example.com/banner.png',
				identityHostUrl: 'https://alice.example/me'
			}
		};
		const result = IdentityExportBundleSchema.parse(bundle);
		expect(result.profile.bio).toBe('Hello');
		expect(result.profile.identityHostUrl).toBe('https://alice.example/me');
	});

	it('rejects missing did', () => {
		const { did: _did, ...rest } = validBundle;
		expect(() => IdentityExportBundleSchema.parse(rest)).toThrow();
	});

	it('rejects invalid DID format in bundle', () => {
		expect(() => IdentityExportBundleSchema.parse({ ...validBundle, did: 'bad' })).toThrow();
	});

	it('rejects profile image URLs that are not http(s)', () => {
		const bundle = {
			...validBundle,
			profile: {
				displayName: 'Alice',
				avatarUrl: 'ftp://evil.example/x.png'
			}
		};
		expect(() => IdentityExportBundleSchema.parse(bundle)).toThrow();
	});
});
