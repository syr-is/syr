import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifySyncToken } from '$lib/server/auth';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { uploadController } from '$lib/controllers/upload.controller';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];

/**
 * POST /api/auth/independent-login/profile-sync
 *
 * Sync profile (display_name, bio, avatar, banner) from Syner.
 * Auth: Authorization: Bearer <sync_token> or ?token=<sync_token>
 */
export const POST: RequestHandler = async ({ request, url }) => {
	const token =
		request.headers
			.get('Authorization')
			?.replace(/^Bearer\s+/i, '')
			.trim() || url.searchParams.get('token');
	if (!token) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Missing sync token' });
	}

	const userId = verifySyncToken(token);
	if (!userId) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Invalid or expired sync token' });
	}

	const user = await userRepository.findById(userId);
	if (!user) {
		throw error(404, { code: 'NOT_FOUND', message: 'User not found' });
	}

	try {
		const formData = await request.formData();
		const displayName = formData.get('display_name');
		const bio = formData.get('bio');
		const avatarFile = formData.get('avatar');
		const bannerFile = formData.get('banner');

		const updates: {
			display_name?: string;
			bio?: string;
			avatar_url?: string;
			banner_url?: string;
		} = {};

		if (typeof displayName === 'string' && displayName.trim()) {
			updates.display_name = displayName.trim().slice(0, 100);
		}
		if (typeof bio === 'string') {
			updates.bio = bio.slice(0, 500);
		}

		if (avatarFile instanceof File && avatarFile.size > 0) {
			if (!IMAGE_TYPES.includes(avatarFile.type)) {
				throw error(400, {
					code: 'VALIDATION_ERROR',
					message: 'Avatar must be an image (png, jpeg, gif, webp)'
				});
			}
			const buf = await avatarFile.arrayBuffer();
			updates.avatar_url = await uploadController.uploadProfileAsset(user, 'avatar', {
				buffer: buf,
				name: avatarFile.name,
				type: avatarFile.type
			});
		}

		if (bannerFile instanceof File && bannerFile.size > 0) {
			if (!IMAGE_TYPES.includes(bannerFile.type)) {
				throw error(400, {
					code: 'VALIDATION_ERROR',
					message: 'Banner must be an image (png, jpeg, gif, webp)'
				});
			}
			const buf = await bannerFile.arrayBuffer();
			updates.banner_url = await uploadController.uploadProfileAsset(user, 'banner', {
				buffer: buf,
				name: bannerFile.name,
				type: bannerFile.type
			});
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
