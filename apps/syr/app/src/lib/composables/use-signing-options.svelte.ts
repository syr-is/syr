import { identityStore } from '$lib/stores/identity.svelte';

/**
 * Centralized signing options derived from identity context.
 * Use in dialogs/components that need to know password vs Syner verification.
 */
export function useSigningOptions() {
	const ctx = identityStore.identityContext;
	return {
		hasIdentity: ctx?.hasIdentity ?? false,
		hasAegis: ctx?.hasAegis ?? false,
		/** Can use password for verification (no identity, or custodial/Aegis) */
		canVerifyWithPassword: !ctx?.hasIdentity || !!ctx?.hasAegis,
		/** Keys in Syner only; must sign with Syner */
		isIndependent: !!(ctx?.hasIdentity && !ctx?.hasAegis),
		did: ctx?.did ?? null
	};
}
