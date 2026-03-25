import { followRepository, type UserFollow } from '$lib/repositories/follow.repository';
import { discoveryRegistryRepository } from '$lib/repositories/discovery-registry.repository';
import { assertFollowableFromRegistries } from '$lib/server/follow-registry-gate.server';
import { normalizeProviderBaseUrl } from '$lib/normalize-provider-base-url';
import { config } from '$lib/config';
import { isValidSyrDid } from '@syr-is/did';
import type { RecordId } from 'surrealdb';

export class FollowValidationError extends Error {
	override readonly name = 'FollowValidationError';
	constructor(message: string) {
		super(message);
	}
}

function normalizeVerifiedProvider(provider: string): string {
	const n = normalizeProviderBaseUrl(provider);
	if (!n) {
		throw new FollowValidationError('Registry returned an invalid provider URL for this DID.');
	}
	return n;
}

export class FollowController {
	private instanceProviderBase(): string {
		const n = normalizeProviderBaseUrl(config.PUBLIC_URL);
		if (!n) {
			throw new FollowValidationError('Server PUBLIC_URL is not a valid provider base URL.');
		}
		return n;
	}

	async follow(
		followerUserId: RecordId | string,
		followerDid: string,
		followedDid: string
	): Promise<UserFollow | null> {
		if (!isValidSyrDid(followedDid)) {
			throw new FollowValidationError('Invalid follow target DID.');
		}

		if (followerDid === followedDid) {
			const row = await followRepository.findOne(followerUserId, followedDid);
			if (row && !row.followed_provider_url) {
				const base = this.instanceProviderBase();
				await followRepository.updateFollowProviderUrl(followerUserId, followedDid, base);
				return (await followRepository.findOne(followerUserId, followedDid)) ?? row;
			}
			return row;
		}

		const existing = await followRepository.findOne(followerUserId, followedDid);
		if (existing) {
			if (!existing.followed_provider_url) {
				const registries = await discoveryRegistryRepository.findByUserId(followerUserId);
				const urls = registries.map((r) => r.registry_url);
				try {
					const { providerBaseUrl } = await assertFollowableFromRegistries(followedDid, urls);
					const normalized = normalizeVerifiedProvider(providerBaseUrl);
					await followRepository.updateFollowProviderUrl(followerUserId, followedDid, normalized);
					return (await followRepository.findOne(followerUserId, followedDid)) ?? existing;
				} catch (e) {
					throw new FollowValidationError(
						e instanceof Error ? e.message : 'Could not backfill provider URL for this follow.'
					);
				}
			}
			return existing;
		}

		const registries = await discoveryRegistryRepository.findByUserId(followerUserId);
		const urls = registries.map((r) => r.registry_url);
		let sourceRegistry: string;
		let providerBaseUrl: string;
		try {
			({ sourceRegistry, providerBaseUrl } = await assertFollowableFromRegistries(
				followedDid,
				urls
			));
		} catch (e) {
			throw new FollowValidationError(e instanceof Error ? e.message : 'Follow validation failed');
		}

		const normalized = normalizeVerifiedProvider(providerBaseUrl);
		return followRepository.createFollow(followerUserId, followedDid, sourceRegistry, normalized);
	}

	/** Re-resolve provider from discovery registries (verified). */
	async refreshFollowProvider(
		followerUserId: RecordId | string,
		followedDid: string
	): Promise<UserFollow> {
		if (!isValidSyrDid(followedDid)) {
			throw new FollowValidationError('Invalid follow target DID.');
		}
		const row = await followRepository.findOne(followerUserId, followedDid);
		if (!row) {
			throw new FollowValidationError('You are not following this DID.');
		}
		const registries = await discoveryRegistryRepository.findByUserId(followerUserId);
		const urls = registries.map((r) => r.registry_url);
		let providerBaseUrl: string;
		try {
			({ providerBaseUrl } = await assertFollowableFromRegistries(followedDid, urls));
		} catch (e) {
			throw new FollowValidationError(e instanceof Error ? e.message : 'Refresh failed');
		}
		const normalized = normalizeVerifiedProvider(providerBaseUrl);
		const updated = await followRepository.updateFollowProviderUrl(
			followerUserId,
			followedDid,
			normalized
		);
		if (!updated) {
			throw new FollowValidationError('Could not update provider URL.');
		}
		return updated;
	}

	/** Manual override: URL shape only, no registry verification. */
	async setFollowProviderUrlManual(
		followerUserId: RecordId | string,
		followedDid: string,
		rawUrl: string
	): Promise<UserFollow> {
		if (!isValidSyrDid(followedDid)) {
			throw new FollowValidationError('Invalid follow target DID.');
		}
		const row = await followRepository.findOne(followerUserId, followedDid);
		if (!row) {
			throw new FollowValidationError('You are not following this DID.');
		}
		const normalized = normalizeProviderBaseUrl(rawUrl);
		if (!normalized) {
			throw new FollowValidationError(
				'Invalid URL. Use an http(s) base URL for the Syr instance (no userinfo).'
			);
		}
		const updated = await followRepository.updateFollowProviderUrl(
			followerUserId,
			followedDid,
			normalized
		);
		if (!updated) {
			throw new FollowValidationError('Could not update provider URL.');
		}
		return updated;
	}

	async unfollow(followerUserId: RecordId | string, followedDid: string) {
		await followRepository.deleteFollow(followerUserId, followedDid);
	}

	async listFollowing(followerUserId: RecordId | string) {
		return followRepository.findByFollower(followerUserId);
	}

	/** Whether this follower has an active follow row for the given DID. */
	async isFollowing(followerUserId: RecordId | string, followedDid: string): Promise<boolean> {
		const row = await followRepository.findOne(followerUserId, followedDid);
		return row != null;
	}
}

export const followController = new FollowController();
