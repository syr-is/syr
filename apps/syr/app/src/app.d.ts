// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Error {
			code?: string;
			message: string;
			details?: Record<string, unknown> | string;
		}
		interface Locals {
			/** Per-request cache for getIdentityContext (keyed by userId). */
			_identityContextCache?: Map<string, import('$lib/server/identity-context').IdentityContext>;
			user?: {
				id: string;
				username: string;
				did?: string;
				role: 'ADMIN' | 'USER';
				sessionId: string;
				created_at: Date;
				updated_at: Date;
				signing_warn_before_each_action?: boolean;
				signing_require_explicit_sign_button?: boolean;
				profile?: {
					id: string;
					display_name: string;
					bio?: string;
					avatar_url?: string;
					banner_url?: string;
					identity_host_url?: string;
					content_signature?: string;
					signed_payload_json?: string;
					signing_device_public_key?: string;
				};
			};
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
