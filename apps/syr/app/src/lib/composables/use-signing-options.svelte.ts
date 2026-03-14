import { getIdentityStore } from '$lib/stores/identity.svelte';

/**
 * Centralized signing options derived from identity context.
 * Returns reactive getters so consumers re-render when identityContext changes.
 * Must be called during component initialization (uses Svelte context).
 */
export function useSigningOptions() {
	const store = getIdentityStore();
	return {
		/** True once layout has populated identity context */
		get isContextReady() {
			return store.isContextReady;
		},
		get hasIdentity() {
			return store.identityContext?.hasIdentity ?? false;
		},
		get hasAegis() {
			return store.identityContext?.hasAegis ?? false;
		},
		/** Can use password for verification (custodial/Aegis) */
		get canVerifyWithPassword() {
			const ctx = store.identityContext;
			if (ctx == null) return false;
			return !!ctx.hasAegis;
		},
		/** Keys in Syner only; must sign with Syner */
		get isIndependent() {
			const ctx = store.identityContext;
			return !!(ctx?.hasIdentity && !ctx?.hasAegis);
		},
		get did() {
			return store.identityContext?.did ?? null;
		}
	};
}
