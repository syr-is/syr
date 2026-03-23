import { followRepository } from '$lib/repositories/follow.repository';
import { discoveryRegistryRepository } from '$lib/repositories/discovery-registry.repository';
import { assertFollowableFromRegistries } from '$lib/server/follow-registry-gate.server';
import { isValidSyrDid } from '@syr-is/did';
import type { RecordId } from 'surrealdb';

export class FollowValidationError extends Error {
	override readonly name = 'FollowValidationError';
	constructor(message: string) {
		super(message);
	}
}

export class FollowController {
	async follow(followerUserId: RecordId | string, followerDid: string, followedDid: string) {
		if (!isValidSyrDid(followedDid)) {
			throw new FollowValidationError('Invalid follow target DID.');
		}
		if (followerDid === followedDid) {
			return (await followRepository.findOne(followerUserId, followedDid)) ?? null;
		}

		const existing = await followRepository.findOne(followerUserId, followedDid);
		if (existing) {
			return existing;
		}

		const registries = await discoveryRegistryRepository.findByUserId(followerUserId);
		const urls = registries.map((r) => r.registry_url);
		let sourceRegistry: string;
		try {
			({ sourceRegistry } = await assertFollowableFromRegistries(followedDid, urls));
		} catch (e) {
			throw new FollowValidationError(e instanceof Error ? e.message : 'Follow validation failed');
		}

		return followRepository.createFollow(followerUserId, followedDid, sourceRegistry);
	}

	async unfollow(followerUserId: RecordId | string, followedDid: string) {
		await followRepository.deleteFollow(followerUserId, followedDid);
	}

	async listFollowing(followerUserId: RecordId | string) {
		return followRepository.findByFollower(followerUserId);
	}
}

export const followController = new FollowController();
