import { defaultTheme } from '@sveltepress/theme-default';
import { sveltepress } from '@sveltepress/vite';
import { defineConfig } from 'vite';
import { remarkMermaid } from './src/lib/remark-mermaid.js';

const sidebarConfig = [
	{
		title: 'Introduction',
		collapsible: true,
		items: [{ title: 'What is Syr?', to: '/introduction' }]
	},
	{
		title: 'Architecture',
		collapsible: true,
		items: [
			{ title: 'Identity Model v0.1', to: '/architecture/identity-model' },
			{ title: 'did:syr Method v0.1', to: '/architecture/did-method' },
			{ title: 'Key Hierarchy & Delegation v0.1', to: '/architecture/key-hierarchy-delegation' },
			{ title: 'Registry Protocol v0.1', to: '/architecture/registry-protocol' },
			{ title: 'Provider Service v0.1', to: '/architecture/provider-service' },
			{ title: 'Recovery & Rotation v0.1', to: '/architecture/recovery-rotation' }
		]
	},
	{
		title: 'Reference',
		collapsible: true,
		items: [
			{ title: 'packages/types', to: '/reference/types' },
			{ title: 'apps/syr', to: '/reference/app' },
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
					'/architecture/': sidebarConfig,
					'/reference/': sidebarConfig,
					'/implementation/': sidebarConfig
				},
				// TODO: Replace with Syr logo before release (e.g. logo: '/syr.svg')
				logo: '/sveltepress.svg',
				editLink: 'https://github.com/syr-is/syr/edit/main/apps/docs/src/routes/:route',
				github: 'https://github.com/syr-is/syr',
				highlighter: {
					languages: ['svelte', 'sh', 'js', 'html', 'ts', 'md', 'css', 'scss', 'json', 'sql']
				}
			}),
			remarkPlugins: [remarkMermaid],
			siteConfig: {
				title: 'Syr',
				description: 'Self Yield Identity Representation -- portable, cryptographically rooted identity'
			}
		})
	]
});

export default config;
