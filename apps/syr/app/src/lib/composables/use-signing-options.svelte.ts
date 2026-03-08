import { identityStore } from '$lib/stores/identity.svelte';

/**
 * Centralized signing options derived from identity context.
 * Returns reactive getters so consumers re-render when identityContext changes.
 */
export function useSigningOptions() {
	return {
		get hasIdentity() {
			return identityStore.identityContext?.hasIdentity ?? false;
		},
		get hasAegis() {
			return identityStore.identityContext?.hasAegis ?? false;
		},
		/** Can use password for verification (custodial/Aegis) */
		get canVerifyWithPassword() {
			const ctx = identityStore.identityContext;
			return !ctx?.hasIdentity || !!ctx?.hasAegis;
		},
		/** Keys in Syner only; must sign with Syner */
		get isIndependent() {
			const ctx = identityStore.identityContext;
			return !!(ctx?.hasIdentity && !ctx?.hasAegis);
		},
		get did() {
			return identityStore.identityContext?.did ?? null;
		}
	};
}
