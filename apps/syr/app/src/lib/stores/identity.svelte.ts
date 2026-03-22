import { getContext, setContext } from 'svelte';

/**
 * Identity context store for client-side identity state.
 * Populated from (private) layout data. Single source for custodial vs Syner identity.
 *
 * Provided per-render via Svelte context to avoid SSR request-isolation issues.
 */
export type IdentityContextClient = {
	hasIdentity: boolean;
	hasAegis: boolean;
	did: string | null;
	/** Multibase root public key — required for in-browser post signing envelopes */
	identityPublicKey: string | null;
	/** When true, API rejects unsigned post mutations */
	requireSignedMutations: boolean;
	/** Active delegated device keys (Syner / other devices) */
	hasDelegatedDeviceKeys: boolean;
};

export class IdentityStore {
	identityContext = $state<IdentityContextClient | null>(null);
	/** True once layout has called setIdentityContext or clearIdentityContext at least once */
	isContextReady = $state(false);

	setIdentityContext(ctx: IdentityContextClient | null) {
		this.isContextReady = true;
		this.identityContext = ctx;
	}

	clearIdentityContext() {
		this.isContextReady = true;
		this.identityContext = null;
	}
}

const IDENTITY_STORE_KEY = Symbol('identity-store');

/** Create a fresh IdentityStore and provide it via Svelte context. Call in a root layout. */
export function setIdentityStoreContext(): IdentityStore {
	const store = new IdentityStore();
	setContext(IDENTITY_STORE_KEY, store);
	return store;
}

/** Retrieve the IdentityStore from Svelte context. Must be called during component init. */
export function getIdentityStore(): IdentityStore {
	return getContext<IdentityStore>(IDENTITY_STORE_KEY);
}
