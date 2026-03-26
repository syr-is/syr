import { describe, it, expect } from 'vitest';
import { RecordId } from 'surrealdb';
import {
	RecordIdSchema,
	TimestampSchema,
	BaseEntitySchema,
	DidSyrSchema,
	MetadataSchema,
	IdentityHostUrlSchema,
	ProfileSignedImageUrlSchema
} from '../common.js';

describe('RecordIdSchema', () => {
	it('accepts a SurrealDB RecordId instance', () => {
		const rid = new RecordId('user', '123');
		expect(RecordIdSchema.parse(rid)).toBe(rid);
	});

	it('rejects a plain string', () => {
		expect(() => RecordIdSchema.parse('user:123')).toThrow();
	});

	it('rejects a number', () => {
		expect(() => RecordIdSchema.parse(123)).toThrow();
	});
});

describe('TimestampSchema', () => {
	it('accepts a Date instance', () => {
		const date = new Date();
		expect(TimestampSchema.parse(date)).toBe(date);
	});

	it('rejects a string', () => {
		expect(() => TimestampSchema.parse('2025-01-01')).toThrow();
	});

	it('rejects a number', () => {
		expect(() => TimestampSchema.parse(Date.now())).toThrow();
	});
});

describe('BaseEntitySchema', () => {
	it('accepts valid base entity', () => {
		const entity = {
			id: new RecordId('user', '1'),
			created_at: new Date(),
			updated_at: new Date()
		};
		const result = BaseEntitySchema.parse(entity);
		expect(result.id).toBe(entity.id);
	});

	it('rejects missing id', () => {
		expect(() =>
			BaseEntitySchema.parse({
				created_at: new Date(),
				updated_at: new Date()
			})
		).toThrow();
	});

	it('rejects string timestamps', () => {
		expect(() =>
			BaseEntitySchema.parse({
				id: new RecordId('user', '1'),
				created_at: '2025-01-01',
				updated_at: '2025-01-01'
			})
		).toThrow();
	});
});

describe('DidSyrSchema', () => {
	it('accepts valid did:syr with multibase', () => {
		expect(
			DidSyrSchema.parse('did:syr:z6MkhaXgBZDvotDkL5LQ48B2Pz2KkJHNQwmfArFBkWYprLi3')
		).toBeTruthy();
	});

	it('rejects did:web', () => {
		expect(() => DidSyrSchema.parse('did:web:example.com')).toThrow();
	});

	it('rejects did:syr without z prefix', () => {
		expect(() => DidSyrSchema.parse('did:syr:abc')).toThrow();
	});
});

describe('IdentityHostUrlSchema', () => {
	it('accepts http and https URLs', () => {
		expect(IdentityHostUrlSchema.parse('http://localhost/u/foo')).toBeTruthy();
		expect(IdentityHostUrlSchema.parse('https://alice.example/me')).toBeTruthy();
	});

	it('rejects non-http(s) schemes', () => {
		expect(() => IdentityHostUrlSchema.parse('ftp://example.com/x')).toThrow();
		expect(() => IdentityHostUrlSchema.parse('javascript:alert(1)')).toThrow();
	});

	it('rejects overlong strings without parsing as URL', () => {
		const long = 'https://x.com/' + 'a'.repeat(2100);
		expect(() => IdentityHostUrlSchema.parse(long)).toThrow();
	});
});

describe('ProfileSignedImageUrlSchema', () => {
	it('matches http(s) rule like IdentityHostUrlSchema', () => {
		expect(ProfileSignedImageUrlSchema.parse('https://cdn.example/a.png')).toBeTruthy();
		expect(() => ProfileSignedImageUrlSchema.parse('data:image/png;base64,AAA')).toThrow();
	});
});

describe('MetadataSchema', () => {
	it('accepts arbitrary key-value pairs', () => {
		const result = MetadataSchema.parse({ foo: 'bar', count: 42 });
		expect(result.foo).toBe('bar');
	});

	it('accepts empty object', () => {
		expect(MetadataSchema.parse({})).toEqual({});
	});
});
