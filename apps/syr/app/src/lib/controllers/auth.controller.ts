import { hashPassword, verifyPassword, generateAccessToken } from '$lib/server/auth';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { sessionRepository } from '$lib/repositories/session.repository';
import { identityController } from '$lib/controllers/identity.controller';
import { buildAegisBundleFromIdentity } from '$lib/utils/aegis-bundle.server';
import type { UserRegistrationInput, UserLogin, User, Profile, Session } from '@syr-is/types';
import type { AegisBundle } from '@syr-is/crypto/aegis';

export interface RegisterResponse {
	user: Omit<User, 'password_hash'>;
	profile: Profile;
	token: string;
}

export interface LoginResponse {
	user: Omit<User, 'password_hash'>;
	profile: Profile | null;
	token: string;
	/** Aegis bundle for client to decrypt and store seed when identity has Aegis */
	aegisBundle?: AegisBundle;
}

/**
 * Auth Controller
 * Business logic for authentication operations
 */
export class AuthController {
	/**
	 * Register a new user
	 */
	async register(
		data: UserRegistrationInput,
		ctx?: { ip?: string; userAgent?: string }
	): Promise<RegisterResponse> {
		const { username, password, display_name } = data;

		// Check if username already exists
		if (await userRepository.usernameExists(username)) {
			throw new Error('Username already exists');
		}

		// Hash password
		const password_hash = await hashPassword(password);

		// Generate did:web identifier
		// const did = generateDID(username);

		// Create user
		const now = new Date();
		const user = await userRepository.create({
			username,
			password_hash,
			// did,
			role: 'USER',
			created_at: now,
			updated_at: now
		} as Partial<User>);

		// Create profile
		const profile = await profileRepository.create({
			user_id: user.id,
			display_name,
			created_at: now,
			updated_at: now
		} as Partial<Profile>);

		// Create identity with Aegis (password-protected seed) at registration
		try {
			await identityController.createIdentityAegis(user.id, password);
		} catch (err) {
			// Rollback: remove created user and profile so caller can retry
			try {
				await profileRepository.delete(profile.id);
			} catch (e) {
				console.error('[auth.controller] Rollback: failed to delete profile', e);
			}
			try {
				await userRepository.delete(user.id);
			} catch (e) {
				console.error('[auth.controller] Rollback: failed to delete user', e);
			}
			throw err;
		}

		// Create session
		const session = await this.createSession(user, ctx);

		// Generate JWT token
		const token = generateAccessToken({
			userId: user.id.toString(),
			sessionId: session.id.toString()
		});

		// Remove password_hash from response
		const { password_hash: _pwd, ...userWithoutPassword } = user;

		return {
			user: userWithoutPassword as Omit<User, 'password_hash'>,
			profile,
			token
		};
	}

	/**
	 * Login a user
	 */
	async login(
		credentials: UserLogin,
		ctx?: { ip?: string; userAgent?: string }
	): Promise<LoginResponse> {
		const { username, password } = credentials;

		// Find user
		const user = await userRepository.findByUsername(username);
		if (!user) {
			throw new Error('Invalid credentials');
		}

		// Verify password
		const isValid = await verifyPassword(user.password_hash, password);
		if (!isValid) {
			throw new Error('Invalid credentials');
		}

		// Find profile
		const profile = await profileRepository.findByUserId(user.id);

		// Fetch identity and include aegisBundle when identity has Aegis (for client decryption)
		let identity: Awaited<ReturnType<typeof identityController.getIdentity>> | null = null;
		try {
			identity = await identityController.getIdentity(user.id);
		} catch (err) {
			console.warn('[auth.controller] getIdentity failed, treating identity as null:', err);
		}
		const aegisBundle = buildAegisBundleFromIdentity(identity);

		// Create session
		const session = await this.createSession(user, ctx);

		// Generate JWT token
		const token = generateAccessToken({
			userId: user.id.toString(),
			sessionId: session.id.toString()
		});

		// Remove password_hash from response
		const { password_hash: _pwd2, ...userWithoutPassword } = user;

		return {
			user: userWithoutPassword as Omit<User, 'password_hash'>,
			profile,
			token,
			...(aegisBundle ? { aegisBundle } : {})
		};
	}

	/**
	 * Logout a user
	 */
	async logout(sessionId: string): Promise<void> {
		await sessionRepository.delete(sessionId);
	}

	/**
	 * Create a new session for a user
	 */
	private async createSession(
		user: User,
		ctx?: { ip?: string; userAgent?: string }
	): Promise<Session> {
		// Generate session token
		const token = this.generateSessionToken();

		// Session expires in 7 days
		const expiresAt = new Date();
		expiresAt.setDate(expiresAt.getDate() + 7);

		const now = new Date();

		const session = await sessionRepository.create({
			user_id: user.id,
			token,
			expires_at: expiresAt,
			created_at: now,
			last_active: now,
			ip: ctx?.ip,
			user_agent: ctx?.userAgent
		} as Partial<Session>);

		return session;
	}

	/**
	 * Generate a random session token
	 */
	private generateSessionToken(): string {
		// Generate a random 32-byte token
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		return Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}

	/**
	 * Validate session by token
	 */
	async validateSession(token: string): Promise<User | null> {
		const session = await sessionRepository.findByToken(token);
		if (!session) {
			return null;
		}

		// Check if session is expired
		const now = new Date();
		const expiresAt = new Date(session.expires_at);
		if (now > expiresAt) {
			await sessionRepository.delete(session.id);
			return null;
		}

		// Get user
		const user = await userRepository.findById(session.user_id);
		return user;
	}
}

// Export singleton instance
export const authController = new AuthController();
