// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user?: {
				id: string;
				username: string;
				role: 'ADMIN' | 'USER';
				sessionId: string;
				created_at: Date;
				updated_at: Date;
				profile?: {
					id: string;
					display_name: string;
					bio?: string;
					avatar_url?: string;
					banner_url?: string;
				};
			};
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
