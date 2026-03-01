import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Load .env from monorepo root (Vite envDir not honored for $env/dynamic/private when run from apps/syr/app)
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
loadDotenv({ path: join(rootDir, '.env') });
loadDotenv({ path: join(rootDir, '.env.local'), override: false });

/**
 * Configuration Schema
 * Validates all environment variables with Zod
 */
const ConfigSchema = z.object({
	// Application
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
	PORT: z.coerce.number().default(5173),
	PUBLIC_URL: z.url().default('http://localhost:5173'),

	// SurrealDB
	SURREALDB_URL: z.string().default('ws://localhost:8000/rpc'),
	SURREALDB_NAMESPACE: z.string().default('syr'),
	SURREALDB_DATABASE: z.string().default('syr'),
	SURREALDB_USER: z.string().default('root'),
	SURREALDB_PASS: z.string().default('syr-dev-password'),

	// JWT
	JWT_SECRET: z
		.string()
		.min(32, 'JWT secret must be at least 32 characters')
		.default('build-time-placeholder-secret-change-in-production-min32chars'),
	JWT_EXPIRES_IN: z.string().default('7d'),

	// DID
	// DID_WEB_DOMAIN: z.string().default('localhost:5173'),

	// S3 / SeaweedFS
	S3_ENDPOINT: z.url().default('http://localhost:8333'),
	S3_ACCESS_KEY_ID: z.string().default('syr-access-key'),
	S3_SECRET_ACCESS_KEY: z.string().default('syr-secret-key'),
	S3_BUCKET: z.string().default('syr'),
	S3_REGION: z.string().default('us-east-1'),
	// Comma-separated origins for S3 bucket CORS (defaults to CORS_ORIGIN)
	S3_CORS_ORIGINS: z.string().optional(),

	// Identity Auth
	IDENTITY_AUTH_CHALLENGE_EXPIRES_IN: z.coerce.number().default(600),
	IDENTITY_AUTH_TOKEN_EXPIRES_IN: z.coerce.number().default(3600),

	// Independent Login (challenge-sign-verify)
	INDEPENDENT_LOGIN_CHALLENGE_TTL: z.coerce.number().default(120),
	INDEPENDENT_LOGIN_CALLBACK_TOKEN_TTL: z.coerce.number().default(60),

	// Security
	RATE_LIMIT_WINDOW: z.coerce.number().default(900000),
	RATE_LIMIT_MAX: z.coerce.number().default(100),

	// CORS - ALLOWED_ORIGINS overrides; when unset, defaults to [PUBLIC_URL]
	ALLOWED_ORIGINS: z.string().optional(),
	CORS_ORIGIN: z.string().optional(),
	CORS_CREDENTIALS: z.coerce.boolean().default(true)
});

type Config = z.infer<typeof ConfigSchema>;

/** Normalize origin for comparison (strip trailing slash, lowercase) */
function normalizeOrigin(url: string): string {
	try {
		const u = new URL(url);
		return u.origin;
	} catch {
		return url;
	}
}

/**
 * Allowed origins for CORS and independent-login challenge validation.
 * Uses ALLOWED_ORIGINS if set (comma-separated), otherwise [PUBLIC_URL].
 */
function allowedOriginsList(parsed: Config): string[] {
	const raw = parsed.ALLOWED_ORIGINS?.trim();
	if (raw) {
		const list = raw
			.split(',')
			.map((o) => normalizeOrigin(o.trim()))
			.filter(Boolean);
		if (list.length > 0) return list;
	}
	return [normalizeOrigin(parsed.PUBLIC_URL)];
}

/** Resolved config with CORS_ORIGIN always set (from PUBLIC_URL when not set). */
type ResolvedConfig = Config & { CORS_ORIGIN: string };

/**
 * Validate and parse configuration
 */
function loadConfig(): Config {
	try {
		const config = ConfigSchema.parse(process.env);
		// Derive CORS_ORIGIN from PUBLIC_URL when not set (enables single-env setup)
		const resolved: ResolvedConfig = {
			...config,
			CORS_ORIGIN: config.CORS_ORIGIN ?? config.PUBLIC_URL
		};
		console.log('✅ Configuration validated successfully');
		return resolved;
	} catch (error) {
		if (error instanceof z.ZodError) {
			console.error('❌ Configuration validation failed:');
			error.issues.forEach((issue) => {
				console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
			});
			throw new Error('Invalid configuration. Please check your environment variables.');
		}
		throw error;
	}
}

/**
 * Validated configuration object
 * All environment variables are validated and typed
 */
const _config = loadConfig();
export const config = _config as ResolvedConfig;

/** Allowed origins for CORS and independent-login challenge validation. */
export const allowedOrigins = allowedOriginsList(_config);

// Log complete config for verification (secrets redacted)
{
	const log = {
		PUBLIC_URL: config.PUBLIC_URL,
		ALLOWED_ORIGINS: config.ALLOWED_ORIGINS ?? '(not set, defaults to [PUBLIC_URL])',
		CORS_ORIGIN: config.CORS_ORIGIN,
		CORS_CREDENTIALS: config.CORS_CREDENTIALS,
		allowedOrigins,
		S3_CORS_ORIGINS: config.S3_CORS_ORIGINS ?? '(not set, defaults to CORS_ORIGIN)',
		s3CorsOrigins: s3CorsOrigins()
	};
	console.log('📋 Config (CORS/origins):', JSON.stringify(log, null, 2));
}

/**
 * Typed configuration exports for convenience
 */
export const db = {
	url: config.SURREALDB_URL,
	namespace: config.SURREALDB_NAMESPACE,
	database: config.SURREALDB_DATABASE,
	user: config.SURREALDB_USER,
	password: config.SURREALDB_PASS
} as const;

export const jwt = {
	secret: config.JWT_SECRET,
	expiresIn: config.JWT_EXPIRES_IN
} as const;

// export const did = {
// 	domain: config.DID_WEB_DOMAIN
// } as const;

/** S3 CORS allowed origins: S3_CORS_ORIGINS if set, otherwise [CORS_ORIGIN]. Never empty. */
function s3CorsOrigins(): string[] {
	const raw = config.S3_CORS_ORIGINS?.trim();
	const list = raw
		? raw
				.split(',')
				.map((o) => o.trim())
				.filter(Boolean)
		: [config.CORS_ORIGIN];
	return list.length > 0 ? list : [config.CORS_ORIGIN];
}

export const s3 = {
	endpoint: config.S3_ENDPOINT,
	accessKeyId: config.S3_ACCESS_KEY_ID,
	secretAccessKey: config.S3_SECRET_ACCESS_KEY,
	bucket: config.S3_BUCKET,
	region: config.S3_REGION,
	corsOrigins: s3CorsOrigins()
} as const;

export const identityAuth = {
	challengeExpiresIn: config.IDENTITY_AUTH_CHALLENGE_EXPIRES_IN,
	tokenExpiresIn: config.IDENTITY_AUTH_TOKEN_EXPIRES_IN
} as const;

export const independentLogin = {
	challengeTtl: config.INDEPENDENT_LOGIN_CHALLENGE_TTL,
	callbackTokenTtl: config.INDEPENDENT_LOGIN_CALLBACK_TOKEN_TTL
} as const;

export const security = {
	rateLimitWindow: config.RATE_LIMIT_WINDOW,
	rateLimitMax: config.RATE_LIMIT_MAX
} as const;

export const cors = {
	/** Primary origin (first in allowed list); use allowedOrigins for multi-origin checks. */
	origin: config.CORS_ORIGIN,
	credentials: config.CORS_CREDENTIALS
} as const;
