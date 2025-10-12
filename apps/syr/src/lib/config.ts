import { z } from 'zod';
import { env } from '$env/dynamic/private';

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
	JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters'),
	JWT_EXPIRES_IN: z.string().default('7d'),

	// DID
	DID_WEB_DOMAIN: z.string().default('localhost:5173'),

	// S3 / SeaweedFS
	S3_ENDPOINT: z.url().default('http://localhost:8333'),
	S3_ACCESS_KEY_ID: z.string().default('syr-access-key'),
	S3_SECRET_ACCESS_KEY: z.string().default('syr-secret-key'),
	S3_BUCKET: z.string().default('syr-storage'),
	S3_REGION: z.string().default('us-east-1'),

	// OAuth
	OAUTH_ISSUER: z.url().optional(),
	OAUTH_AUTH_CODE_EXPIRES_IN: z.coerce.number().default(600),
	OAUTH_ACCESS_TOKEN_EXPIRES_IN: z.coerce.number().default(3600),
	OAUTH_REFRESH_TOKEN_EXPIRES_IN: z.coerce.number().default(2592000),

	// Security
	RATE_LIMIT_WINDOW: z.coerce.number().default(900000),
	RATE_LIMIT_MAX: z.coerce.number().default(100),

	// CORS
	CORS_ORIGIN: z.string().default('http://localhost:5173'),
	CORS_CREDENTIALS: z.coerce.boolean().default(true)
});

type Config = z.infer<typeof ConfigSchema>;

/**
 * Validate and parse configuration
 */
function loadConfig(): Config {
	try {
		const config = ConfigSchema.parse(env);
		console.log('✅ Configuration validated successfully');
		return config;
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
export const config = loadConfig();

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

export const did = {
	domain: config.DID_WEB_DOMAIN
} as const;

export const s3 = {
	endpoint: config.S3_ENDPOINT,
	accessKeyId: config.S3_ACCESS_KEY_ID,
	secretAccessKey: config.S3_SECRET_ACCESS_KEY,
	bucket: config.S3_BUCKET,
	region: config.S3_REGION
} as const;

export const oauth = {
	issuer: config.OAUTH_ISSUER ?? config.PUBLIC_URL,
	authCodeExpiresIn: config.OAUTH_AUTH_CODE_EXPIRES_IN,
	accessTokenExpiresIn: config.OAUTH_ACCESS_TOKEN_EXPIRES_IN,
	refreshTokenExpiresIn: config.OAUTH_REFRESH_TOKEN_EXPIRES_IN
} as const;

export const security = {
	rateLimitWindow: config.RATE_LIMIT_WINDOW,
	rateLimitMax: config.RATE_LIMIT_MAX
} as const;

export const cors = {
	origin: config.CORS_ORIGIN,
	credentials: config.CORS_CREDENTIALS
} as const;
