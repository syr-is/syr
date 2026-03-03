import { verify, decodeMultibase } from '@syr-is/crypto';
import { parseDid } from '@syr-is/did';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { sessionRepository } from '$lib/repositories/session.repository';
import { identityRepository } from '$lib/repositories/identity.repository';
import { jwt } from '$lib/config';
import { generateAccessToken } from '$lib/server/auth';
import type { User } from '@syr-is/types';

/**
 * Independent Login Controller
 * Challenge-sign-verify flow for Syner/external key authentication.
 */
export class IndependentLoginController {
	/**
	 * Verify signature and return user (create if new).
	 * Throws on invalid signature, expired challenge, or invite-required (future).
	 */
	async verifyAndGetUser(
		challengeId: string,
		did: string,
		message: string,
		signature: string,
		_inviteCode?: string,
		profileData?: { display_name?: string; bio?: string }
	): Promise<User> {
		const parsedDid = parseDid(did);
		const publicKeyBytes = parsedDid.publicKey;
		const signatureBytes = decodeMultibase(signature);
		const messageBytes = new TextEncoder().encode(message);

		const isValid = await verify(messageBytes, signatureBytes, publicKeyBytes);
		if (!isValid) {
			throw new Error('Invalid signature');
		}

		// Check if identity exists
		const identity = await identityRepository.findByDid(did);
		if (identity) {
			const user = await userRepository.findById(identity.user_id);
			if (!user) throw new Error('User not found');
			return user;
		}

		// New user: create user + profile + identity (extensible for invite check later)
		// Future: if INVITE_ONLY_MODE && !inviteCode valid -> throw 'invite_required'
		const username = this.deriveUsername(did);
		const now = new Date();
		const passwordHash = await this.generatePlaceholderPasswordHash();

		const user = await userRepository.create({
			username,
			password_hash: passwordHash,
			role: 'USER',
			created_at: now,
			updated_at: now
		} as Partial<User>);

		let profile;
		try {
			profile = await profileRepository.createByUserId(user.id, {
				display_name: profileData?.display_name,
				bio: profileData?.bio
			});
		} catch (err) {
			await userRepository.delete(user.id);
			throw err;
		}

		try {
			const publicKeyFromDid = did.replace(/^did:syr:/, '');
			await identityRepository.createIdentityExternal({
				did,
				publicKey: publicKeyFromDid,
				userId: user.id,
				now
			});
		} catch (err) {
			if (profile) await profileRepository.delete(profile.id);
			await userRepository.delete(user.id);
			throw err;
		}

		return user;
	}

	private deriveUsername(did: string): string {
		const idPart = did.replace(/^did:syr:/, '');
		const suffix = idPart.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 18);
		const base = `il_${suffix || 'user'}`;
		const final = base.length > 28 ? base.slice(0, 28) : base;
		const random = crypto.randomUUID().slice(0, 6);
		return `${final}_${random}`;
	}

	private async generatePlaceholderPasswordHash(): Promise<string> {
		const crypto = await import('crypto');
		const random = crypto.randomBytes(32).toString('hex');
		const { hashPassword } = await import('$lib/server/auth');
		return hashPassword(random);
	}

	/**
	 * Create session and return JWT for cookie.
	 */
	async createSessionForUser(
		user: User,
		ctx?: { ip?: string; userAgent?: string }
	): Promise<string> {
		const sessionToken = this.generateSessionToken();
		const expiresAt = new Date();
		expiresAt.setDate(expiresAt.getDate() + 7);
		const now = new Date();

		const session = await sessionRepository.create({
			user_id: user.id,
			token: sessionToken,
			expires_at: expiresAt,
			created_at: now,
			last_active: now,
			ip: ctx?.ip,
			user_agent: ctx?.userAgent
		} as Parameters<typeof sessionRepository.create>[0]);

		return generateAccessToken(
			{ userId: user.id.toString(), sessionId: session.id.toString() },
			jwt.expiresIn
		);
	}

	private generateSessionToken(): string {
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		return Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}
}

export const independentLoginController = new IndependentLoginController();
