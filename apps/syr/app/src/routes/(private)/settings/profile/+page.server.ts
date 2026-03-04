import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { PageServerLoad } from './$types';
import { userRepository } from '$lib/repositories/user.repository';
import { getUsernameChangeCooldownDays } from '$lib/instance-config';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		await goto(resolve('/login'));
		return;
	}

	const fullUser = await userRepository.findById(locals.user.id);
	const cooldownDays = await getUsernameChangeCooldownDays();

	let canChangeUsername = true;
	let nextUsernameChangeAt: Date | null = null;

	if (fullUser?.username_last_updated) {
		const msPerDay = 24 * 60 * 60 * 1000;
		const elapsedMs = Date.now() - fullUser.username_last_updated.getTime();
		if (elapsedMs < cooldownDays * msPerDay) {
			canChangeUsername = false;
			nextUsernameChangeAt = new Date(
				fullUser.username_last_updated.getTime() + cooldownDays * msPerDay
			);
		}
	}

	return {
		user: locals.user,
		canChangeUsername,
		nextUsernameChangeAt: nextUsernameChangeAt?.toISOString() ?? null,
		usernameChangeCooldownDays: cooldownDays
	};
};
