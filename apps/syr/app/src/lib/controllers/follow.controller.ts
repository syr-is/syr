import { followRepository } from '$lib/repositories/follow.repository';
import { registryRepository } from '$lib/repositories/registry.repository';
import { assertFollowableFromRegistries } from '$lib/server/follow-registry-gate.server';
import { isValidSyrDid } from '@syr-is/did';
import type { RecordId } from 'surrealdb';

export class FollowController {
	async follow(followerUserId: RecordId | string, followerDid: string, followedDid: string) {
		if (!isValidSyrDid(followedDid)) {
			throw new Error('Invalid follow target DID.');
		}
		if (followerDid === followedDid) {
			return (await followRepository.findOne(followerUserId, followedDid)) ?? null;
		}

		const registries = await registryRepository.findByDid(followerDid);
		const urls = registries.map((r) => r.registry_url);
		const { sourceRegistry } = await assertFollowableFromRegistries(followedDid, urls);

		const existing = await followRepository.findOne(followerUserId, followedDid);
		if (existing) {
			return existing;
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
