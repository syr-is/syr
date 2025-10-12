import jwt, { type SignOptions } from 'jsonwebtoken';
import { hash, verify } from '@node-rs/argon2';
import { jwt as jwtConfig, did as didConfig } from '$lib/config';

/**
 * Argon2id configuration
 * OWASP recommended settings
 */
const ARGON2_OPTIONS = {
	memoryCost: 65536, // 64 MiB
	timeCost: 3, // 3 iterations
	parallelism: 4 // 4 threads
};

/**
 * Hash a password using Argon2id
 */
export async function hashPassword(password: string): Promise<string> {
	return hash(password, ARGON2_OPTIONS);
}

/**
 * Verify a password against its hash
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
	try {
		return await verify(hash, password, ARGON2_OPTIONS);
	} catch (error) {
		console.error('Password verification error:', error);
		return false;
	}
}

/**
 * JWT Payload
 */
export interface JWTPayload {
	userId: string;
	username: string;
	role: 'ADMIN' | 'USER';
	sessionId: string;
}

/**
 * Generate JWT access token
 */
export function generateAccessToken(payload: JWTPayload): string {
	return jwt.sign(payload, jwtConfig.secret, {
		expiresIn: jwtConfig.expiresIn,
		issuer: 'syr',
		audience: 'syr-api'
	} as SignOptions);
}

/**
 * Verify and decode JWT token
 */
export function verifyAccessToken(token: string): JWTPayload | null {
	try {
		const decoded = jwt.verify(token, jwtConfig.secret, {
			issuer: 'syr',
			audience: 'syr-api'
		}) as JWTPayload;
		return decoded;
	} catch (error) {
		console.error('JWT verification error:', error);
		return null;
	}
}

/**
 * Generate did:web identifier for a user
 */
export function generateDID(username: string): string {
	return `did:web:${didConfig.domain}:users:${username}`;
}

/**
 * Extract user ID from JWT token in request
 */
export function getUserIdFromToken(authHeader: string | null): string | null {
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return null;
	}

	const token = authHeader.substring(7);
	const payload = verifyAccessToken(token);
	return payload?.userId ?? null;
}
