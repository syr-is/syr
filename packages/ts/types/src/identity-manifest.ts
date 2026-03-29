import { z } from 'zod';

/**
 * Per-identity manifest served at `/.well-known/syr/{did}`.
 *
 * Advertises the absolute URLs where a consumer can reach profile, posts,
 * stories, uploads, and DID document endpoints for a specific identity.
 *
 * Content negotiation on the manifest URL:
 *   Accept: application/json  → manifest JSON
 *   Accept: text/html         → 302 redirect to `web_profile`
 */
export const SyrIdentityManifestSchema = z.object({
	version: z.literal(1),
	did: z.string(),
	provider: z.string().url(),
	endpoints: z.object({
		profile: z.string().url(),
		posts: z.string().url(),
		stories: z.string().url(),
		uploads: z.string().url(),
		did_document: z.string().url()
	}),
	web_profile: z.string().url()
});

export type SyrIdentityManifest = z.infer<typeof SyrIdentityManifestSchema>;

/**
 * Instance-level manifest served at `/.well-known/syr`.
 *
 * Includes public API base paths, identity manifest template,
 * and Syner endpoint URL templates for operational flows (auth, identity, signing).
 *
 * URL templates use `{id}` as a placeholder for dynamic path segments
 * (challenge IDs, session IDs) — consumers replace `{id}` with the actual value.
 */
export const SyrInstanceManifestSchema = z.object({
	name: z.literal('syr'),
	public_url: z.string().url(),
	api: z.object({
		public_profile: z.string().url(),
		public_posts: z.string().url(),
		public_stories: z.string().url(),
		public_uploads: z.string().url()
	}),
	identity_manifest_template: z.string(),
	syner: z
		.object({
			independent_login_challenge: z.string(),
			independent_login_verify: z.string(),
			profile_sync: z.string(),
			export_challenge: z.string(),
			export_verify: z.string(),
			export_signatures: z.string(),
			sigil_handoff_payload: z.string(),
			post_sign_payload: z.string(),
			post_sign_signature: z.string(),
			registry_sign_payload: z.string(),
			registry_sign_signature: z.string()
		})
		.optional()
});

export type SyrInstanceManifest = z.infer<typeof SyrInstanceManifestSchema>;
