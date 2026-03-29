import { followRepository, type UserFollow } from '$lib/repositories/follow.repository';
import { userRepository } from '$lib/repositories/user.repository';
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
	private async followerDidOrThrow(followerUserId: RecordId | string): Promise<string> {
		const user = await userRepository.findById(followerUserId);
		if (!user?.did) {
			throw new FollowValidationError('Identity required.');
		}
		return user.did;
	}

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
		followedDid: string,
		explicitProviderUrl?: string
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

		// When an explicit provider URL is given (e.g. from a third-party instance's follow button),
		// check if already following this DID on this specific provider
		if (explicitProviderUrl) {
			const normalized = normalizeProviderBaseUrl(explicitProviderUrl);
			if (!normalized) {
				throw new FollowValidationError('Invalid provider URL.');
			}
			const existing = await followRepository.findOne(followerUserId, followedDid, normalized);
			if (existing) return existing;
			return followRepository.createFollow(followerUserId, followedDid, 'manual', normalized);
		}

		// No explicit provider — check if already following on any instance
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
					console.error('[follow.controller] Legacy provider URL backfill failed', {
						followedDid,
						error: e instanceof Error ? e.message : String(e)
					});
					return existing;
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
		const followerDid = await this.followerDidOrThrow(followerUserId);
		let normalized: string;
		if (followerDid === followedDid) {
			normalized = this.instanceProviderBase();
		} else {
			const registries = await discoveryRegistryRepository.findByUserId(followerUserId);
			const urls = registries.map((r) => r.registry_url);
			let providerBaseUrl: string;
			try {
				({ providerBaseUrl } = await assertFollowableFromRegistries(followedDid, urls));
			} catch (e) {
				throw new FollowValidationError(e instanceof Error ? e.message : 'Refresh failed');
			}
			normalized = normalizeVerifiedProvider(providerBaseUrl);
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
		const followerDid = await this.followerDidOrThrow(followerUserId);
		if (followerDid === followedDid) {
			throw new FollowValidationError(
				'Manual provider URL override is not allowed for your own DID; this instance is always the provider.'
			);
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

	async unfollow(followerUserId: RecordId | string, followedDid: string, providerUrl?: string) {
		await followRepository.deleteFollow(followerUserId, followedDid, providerUrl);
	}

	async listFollowing(followerUserId: RecordId | string) {
		return followRepository.findByFollower(followerUserId);
	}

	/** Whether this follower has an active follow row for the given DID (optionally on a specific provider). */
	async isFollowing(
		followerUserId: RecordId | string,
		followedDid: string,
		providerUrl?: string
	): Promise<boolean> {
		const row = await followRepository.findOne(followerUserId, followedDid, providerUrl);
		return row != null;
	}
}

export const followController = new FollowController();
