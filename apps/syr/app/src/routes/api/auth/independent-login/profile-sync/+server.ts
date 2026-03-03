import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verify, decodeMultibase } from '@syr-is/crypto';
import { parseDid } from '@syr-is/did';
import { ProfileSyncSignedPayloadSchema, type ProfileSyncSignedPayload } from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { uploadController } from '$lib/controllers/upload.controller';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_BANNER_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * GET /api/auth/independent-login/profile-sync
 *
 * Deprecated: DID is now included in the QR. Returns 410 Gone.
 */
export const GET: RequestHandler = async () => {
	throw error(410, {
		code: 'GONE',
		message: 'DID is now included in the sync-profile URL. Scan the QR from SYR Settings.'
	});
};

/**
 * POST /api/auth/independent-login/profile-sync
 *
 * Sync profile (display_name, bio, avatar, banner) from Syner.
 * Auth: Ed25519 signature over payload (no JWT). Server looks up user by DID.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const formData = await request.formData();
		const requestDid = formData.get('did');
		if (typeof requestDid !== 'string' || !requestDid.trim()) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Profile sync requires did'
			});
		}
		const did = requestDid.trim();

		const user = await userRepository.findByDid(did);
		if (!user) {
			throw error(403, {
				code: 'FORBIDDEN',
				message: 'No SYR account found for this identity'
			});
		}
		if (!user.did) {
			throw error(403, {
				code: 'FORBIDDEN',
				message: 'Profile sync requires an identity (DID) on the SYR account'
			});
		}

		const userId = user.id;

		const signature = formData.get('signature');
		const signedPayloadStr = formData.get('signed_payload');
		if (
			typeof signature !== 'string' ||
			!signature.trim() ||
			typeof signedPayloadStr !== 'string' ||
			!signedPayloadStr.trim()
		) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message:
					'Profile sync requires signature and signed_payload (proves control of persona private key)'
			});
		}

		let parsedPayload: ProfileSyncSignedPayload;
		try {
			parsedPayload = ProfileSyncSignedPayloadSchema.parse(JSON.parse(signedPayloadStr));
		} catch {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Invalid signed_payload format'
			});
		}
		if (parsedPayload.action !== 'profile-sync' || parsedPayload.did !== did) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Signed payload must match request (action=profile-sync, did)'
			});
		}
		const issuedAt = new Date(parsedPayload.issued_at).getTime();
		const age = Date.now() - issuedAt;
		if (isNaN(issuedAt) || age < 0 || age > SIGNATURE_MAX_AGE_MS) {
			throw error(400, {
				code: 'VALIDATION_ERROR',
				message: 'Signed payload expired or invalid timestamp (max 5 minutes)'
			});
		}

		const parsedDid = parseDid(did);
		const signatureBytes = decodeMultibase(signature.trim());
		const messageBytes = new TextEncoder().encode(signedPayloadStr);
		const isValid = await verify(messageBytes, signatureBytes, parsedDid.publicKey);
		if (!isValid) {
			throw error(403, {
				code: 'FORBIDDEN',
				message: 'Invalid signature: must sign with persona private key'
			});
		}

		const avatarFile = formData.get('avatar');
		const bannerFile = formData.get('banner');

		const updates: {
			display_name?: string;
			bio?: string;
			avatar_url?: string;
			banner_url?: string;
		} = {};

		if (typeof parsedPayload.display_name === 'string' && parsedPayload.display_name.trim()) {
			updates.display_name = parsedPayload.display_name.trim().slice(0, 100);
		}
		if (typeof parsedPayload.bio === 'string') {
			updates.bio = parsedPayload.bio.slice(0, 500);
		}

		if (avatarFile instanceof File && avatarFile.size > 0) {
			if (avatarFile.size > MAX_AVATAR_BYTES) {
				throw error(413, {
					code: 'PAYLOAD_TOO_LARGE',
					message: `Avatar must be under ${MAX_AVATAR_BYTES / 1024 / 1024} MB`
				});
			}
			if (!IMAGE_TYPES.includes(avatarFile.type)) {
				throw error(400, {
					code: 'VALIDATION_ERROR',
					message: 'Avatar must be an image (png, jpeg, gif, webp)'
				});
			}
			const buf = await avatarFile.arrayBuffer();
			const baseUrl = await uploadController.uploadProfileAsset(user, 'avatar', {
				buffer: buf,
				name: avatarFile.name,
				type: avatarFile.type
			});
			updates.avatar_url = baseUrl;
		}

		if (bannerFile instanceof File && bannerFile.size > 0) {
			if (bannerFile.size > MAX_BANNER_BYTES) {
				throw error(413, {
					code: 'PAYLOAD_TOO_LARGE',
					message: `Banner must be under ${MAX_BANNER_BYTES / 1024 / 1024} MB`
				});
			}
			if (!IMAGE_TYPES.includes(bannerFile.type)) {
				throw error(400, {
					code: 'VALIDATION_ERROR',
					message: 'Banner must be an image (png, jpeg, gif, webp)'
				});
			}
			const buf = await bannerFile.arrayBuffer();
			const baseUrl = await uploadController.uploadProfileAsset(user, 'banner', {
				buffer: buf,
				name: bannerFile.name,
				type: bannerFile.type
			});
			updates.banner_url = baseUrl;
		}

		let profile = await profileRepository.findByUserId(userId);
		if (profile) {
			profile = await profileRepository.mergeByUserId(userId, updates);
		} else if (Object.keys(updates).length > 0) {
			profile = await profileRepository.createByUserId(userId, {
				display_name: updates.display_name ?? user.username,
				bio: updates.bio
			});
			if (profile && (updates.avatar_url || updates.banner_url)) {
				profile = await profileRepository.mergeByUserId(userId, {
					avatar_url: updates.avatar_url,
					banner_url: updates.banner_url
				});
			}
		}
		return json({
			status: 'success' as const,
			profile: profile
				? {
						display_name: profile.display_name,
						bio: profile.bio,
						avatar_url: profile.avatar_url,
						banner_url: profile.banner_url
					}
				: null
		});
	} catch (err) {
		if (
			err &&
			typeof err === 'object' &&
			'status' in err &&
			typeof (err as { status: number }).status === 'number'
		) {
			throw err;
		}
		console.error('Profile sync error:', err);
		throw error(500, {
			code: 'INTERNAL_ERROR',
			message: 'An unexpected error occurred'
		});
	}
};
