/**
 * User session store for client-side user state.
 * Synced from layout data so sidebar and other consumers react when profile updates.
 */
class UserSessionStore {
	user = $state<App.Locals['user'] | null>(null);

	setUser(u: App.Locals['user'] | null) {
		this.user = u;
	}

	clearUser() {
		this.user = null;
	}
}

export const userSessionStore = new UserSessionStore();
