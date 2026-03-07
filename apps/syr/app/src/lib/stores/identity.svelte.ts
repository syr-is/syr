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

	setIdentityContext(ctx: IdentityContextClient | null) {
		this.identityContext = ctx;
	}

	clearIdentityContext() {
		this.identityContext = null;
	}
}

export const identityStore = new IdentityStore();
