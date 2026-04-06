import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stringToRecordId } from '@syr-is/types';
import { userRepository } from '$lib/repositories/user.repository';
import { profileRepository } from '$lib/repositories/profile.repository';
import { deleteAccount } from '$lib/services/account-deletion.service';

function requireAdmin(locals: App.Locals) {
	if (!locals.user) {
		throw error(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });
	}
	if (locals.user.role !== 'ADMIN') {
		throw error(403, {
			code: 'FORBIDDEN',
			message: 'Only instance administrators can manage users'
		});
	}
}

export const GET: RequestHandler = async ({ params, locals }) => {
	requireAdmin(locals);

	let userId;
	try {
		userId = stringToRecordId.decode(params.userId);
	} catch {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid user ID' });
	}

	const user = await userRepository.findById(userId);
	if (!user) {
		throw error(404, { code: 'NOT_FOUND', message: 'User not found' });
	}

	const profile = await profileRepository.findByUserId(userId);

	return json({
		status: 'success',
		data: {
			id: user.id.toString(),
			username: user.username,
			did: user.did ?? null,
			role: user.role,
			created_at: user.created_at.toISOString(),
			updated_at: user.updated_at.toISOString(),
			display_name: profile?.display_name ?? user.username,
			bio: profile?.bio ?? null,
			avatar_url: profile?.avatar_url ?? null
		}
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireAdmin(locals);

	// Prevent self-deletion
	if (params.userId === locals.user!.id) {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Cannot delete your own account' });
	}

	let userId;
	try {
		userId = stringToRecordId.decode(params.userId);
	} catch {
		throw error(400, { code: 'VALIDATION_ERROR', message: 'Invalid user ID' });
	}

	const user = await userRepository.findById(userId);
	if (!user) {
		throw error(404, { code: 'NOT_FOUND', message: 'User not found' });
	}

	await deleteAccount(userId);

	return json({ status: 'success', message: 'User account deleted' });
};
