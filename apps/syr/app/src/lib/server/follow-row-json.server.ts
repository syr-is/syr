import type { UserFollow } from '$lib/repositories/follow.repository';

export function followRowToJson(r: UserFollow) {
	return {
		followed_did: r.followed_did,
		source_registry: r.source_registry,
		followed_provider_url: r.followed_provider_url ?? null,
		is_public: r.is_public ?? false,
		created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
	};
}

/** Public-safe serialization — omits source_registry */
export function publicFollowRowToJson(r: UserFollow) {
	return {
		followed_did: r.followed_did,
		followed_provider_url: r.followed_provider_url ?? null,
		created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
	};
}
