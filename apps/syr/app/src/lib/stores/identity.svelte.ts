/**
 * Identity context store for client-side identity state.
 * Populated from (private) layout data. Single source for custodial vs Syner identity.
 */
export type IdentityContextClient = {
	hasIdentity: boolean;
	hasAegis: boolean;
	did: string | null;
};

class IdentityStore {
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

export const identityStore = new IdentityStore();
