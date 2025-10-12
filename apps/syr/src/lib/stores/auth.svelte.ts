import type { User, Profile } from '@syr-is/types';

/**
 * Auth Store (Svelte 5 Runes)
 * Client-side authentication state management
 */
class AuthStore {
	user = $state<User | null>(null);
	profile = $state<Profile | null>(null);
	token = $state<string | null>(null);
	loading = $state(false);

	constructor() {
		// Load token from localStorage on initialization (browser only)
		if (typeof window !== 'undefined') {
			const storedToken = localStorage.getItem('auth_token');
			if (storedToken) {
				this.token = storedToken;
				// Optionally validate token and fetch user data
			}
		}
	}

	/**
	 * Set authentication data
	 */
	setAuth(user: User, profile: Profile | null, token: string) {
		this.user = user;
		this.profile = profile;
		this.token = token;
		if (typeof window !== 'undefined') {
			localStorage.setItem('auth_token', token);
		}
	}

	/**
	 * Clear authentication data
	 */
	logout() {
		this.user = null;
		this.profile = null;
		this.token = null;
		if (typeof window !== 'undefined') {
			localStorage.removeItem('auth_token');
		}
	}

	/**
	 * Check if user is authenticated
	 */
	get isAuthenticated(): boolean {
		return this.token !== null;
	}

	/**
	 * Get authorization header
	 */
	get authHeader(): string | null {
		return this.token ? `Bearer ${this.token}` : null;
	}
}

export const authStore = new AuthStore();

