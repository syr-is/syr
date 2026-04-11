import { defaultTheme } from '@sveltepress/theme-default';
import { sveltepress } from '@sveltepress/vite';
import type { Plugin } from 'unified';
import { defineConfig } from 'vite';
import { remarkMermaid } from './src/lib/remark-mermaid';

const sidebarConfig = [
	{
		title: 'Introduction',
		collapsible: true,
		items: [
			{ title: 'What is Syr?', to: '/introduction' },
			{ title: 'Roadmap', to: '/roadmap' }
		]
	},
	{
		title: 'Implementer Guide',
		collapsible: true,
		items: [
			{ title: 'Integration Overview', to: '/implementer-guide' },
			{ title: 'syr:// Scheme and QR Exchange', to: '/implementer-guide/scheme-and-qr' },
			{ title: 'Export Formats and Data Structures', to: '/implementer-guide/export-formats' },
			{ title: 'Challenge-Sign Flows', to: '/implementer-guide/challenge-sign-flows' },
			{ title: 'Profile Sync API', to: '/implementer-guide/profile-sync' },
			{ title: 'Follow on Syr', to: '/implementer-guide/follow-on-syr' }
		]
	},
	{
		title: 'Architecture',
		collapsible: true,
		items: [
			{ title: 'Identity Model v0.1', to: '/architecture/identity-model' },
			{
				title: 'Identity Lifecycle (One DID, One Key)',
				to: '/architecture/identity-lifecycle-simplified'
			},
			{ title: 'did:syr Method v0.1', to: '/architecture/did-method' },
			{ title: 'Key Hierarchy & Delegation v0.1', to: '/architecture/key-hierarchy-delegation' },
			{
				title: 'Signed Profile & Post Mutations',
				to: '/architecture/signed-profile-post-mutations'
			},
			{ title: 'Signature Verification UI', to: '/architecture/signature-verification-ui' },
			{ title: 'Follows, Discovery & Home Timeline', to: '/architecture/follows-and-timeline' },
			{ title: 'Profile stories (v1 spec)', to: '/architecture/profile-stories' },
			{ title: 'Sigil v1 (Export Format)', to: '/architecture/sigil' },
			{ title: 'Export Formats (SYR, Sigil, Persona)', to: '/architecture/export' },
			{ title: 'Identity Import', to: '/architecture/import' },
			{ title: 'Aegis v1 (Custodial Identity)', to: '/architecture/aegis' },
			{ title: 'Syner (Self-Custody Companion)', to: '/architecture/syner' },
			{ title: 'Independent Login', to: '/architecture/independent-login' },
			{ title: 'Registry Protocol v0.1', to: '/architecture/registry-protocol' },
			{ title: 'Provider Service v0.1', to: '/architecture/provider-service' },
			{ title: 'Recovery & Rotation v0.1', to: '/architecture/recovery-rotation' },
			{ title: 'Emoji & Sticker Store (v1)', to: '/architecture/emoji-sticker-store' },
			{ title: 'GIF Store (v1)', to: '/architecture/gif-store' },
			{ title: 'Comments & Reactions (v1)', to: '/architecture/comments-reactions' }
		]
	},
	{
		title: 'Reference',
		collapsible: true,
		items: [
			{ title: 'packages/types', to: '/reference/types' },
			{ title: 'apps/syr', to: '/reference/app' },
			{ title: 'Public read API', to: '/reference/public-api' },
			{ title: 'Independent Login API', to: '/reference/independent-login-api' },
			{ title: 'Spec-to-Implementation Map', to: '/reference/spec-mapping' }
		]
	},
	{
		title: 'Implementation',
		collapsible: true,
		items: [
			{ title: 'Phase 0 Blueprint', to: '/implementation/phase-0-blueprint' },
			{ title: 'Phase 0: packages/crypto', to: '/implementation/phase-0-crypto' },
			{ title: 'Phase 0: packages/did', to: '/implementation/phase-0-did' },
			{ title: 'Phase 0: Database Schema', to: '/implementation/phase-0-database' },
			{ title: 'Phase 0: Identity Flows', to: '/implementation/phase-0-identity-flows' }
		]
	}
];

const config = defineConfig({
	plugins: [
		sveltepress({
			theme: defaultTheme({
				navbar: [
					{ title: 'Home', to: '/' },
					{ title: 'Introduction', to: '/introduction' },
					{ title: 'Docs', to: '/architecture/identity-model' }
				],
				sidebar: {
					'/': sidebarConfig,
					'/introduction/': sidebarConfig,
					'/roadmap/': sidebarConfig,
					'/implementer-guide/': sidebarConfig,
					'/architecture/': sidebarConfig,
					'/reference/': sidebarConfig,
					'/implementation/': sidebarConfig
				},
				// TODO: Replace with Syr logo before release (e.g. logo: '/syr.svg')
				logo: '/sveltepress.svg',
				editLink: 'https://github.com/syr-is/syr/edit/main/apps/docs/app/src/routes/:route',
				github: 'https://github.com/syr-is/syr',
				highlighter: {
					languages: ['svelte', 'sh', 'js', 'html', 'ts', 'md', 'css', 'scss', 'json', 'sql']
				}
			}),
			remarkPlugins: [remarkMermaid as Plugin],
			siteConfig: {
				title: 'Syr',
				description:
					'Self Yield Identity Representation -- portable, cryptographically rooted identity'
			}
		})
	]
});

export default config;
