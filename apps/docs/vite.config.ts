import { defaultTheme } from '@sveltepress/theme-default';
import { sveltepress } from '@sveltepress/vite';
import { defineConfig } from 'vite';

const config = defineConfig({
	plugins: [
		sveltepress({
			theme: defaultTheme({
				navbar: [
					{ title: 'Home', to: '/' },
					{ title: 'Docs', to: '/architecture/identity-model' }
				],
				sidebar: {
					'/': [
						{
							title: 'Base specs',
							collapsible: true,
							items: [
								{ title: 'Identity Model v0.1', to: '/architecture/identity-model' },
								{ title: 'did:syr Method v0.1', to: '/architecture/did-method' },
								{ title: 'Registry Protocol v0.1', to: '/architecture/registry-protocol' },
								{ title: 'Provider Service v0.1', to: '/architecture/provider-service' },
								{ title: 'Recovery & Rotation v0.1', to: '/architecture/recovery-rotation' }
							]
						},
						{
							title: 'Implementation',
							collapsible: true,
							items: [{ title: 'Phase 0 Blueprint', to: '/implementation/phase-0-blueprint' }]
						}
					],
					'/architecture/': [
						{
							title: 'Base specs',
							collapsible: true,
							items: [
								{ title: 'Identity Model v0.1', to: '/architecture/identity-model' },
								{ title: 'did:syr Method v0.1', to: '/architecture/did-method' },
								{ title: 'Registry Protocol v0.1', to: '/architecture/registry-protocol' },
								{ title: 'Provider Service v0.1', to: '/architecture/provider-service' },
								{ title: 'Recovery & Rotation v0.1', to: '/architecture/recovery-rotation' }
							]
						},
						{
							title: 'Implementation',
							collapsible: true,
							items: [{ title: 'Phase 0 Blueprint', to: '/implementation/phase-0-blueprint' }]
						}
					],
					'/implementation/': [
						{
							title: 'Base specs',
							collapsible: true,
							items: [
								{ title: 'Identity Model v0.1', to: '/architecture/identity-model' },
								{ title: 'did:syr Method v0.1', to: '/architecture/did-method' },
								{ title: 'Registry Protocol v0.1', to: '/architecture/registry-protocol' },
								{ title: 'Provider Service v0.1', to: '/architecture/provider-service' },
								{ title: 'Recovery & Rotation v0.1', to: '/architecture/recovery-rotation' }
							]
						},
						{
							title: 'Implementation',
							collapsible: true,
							items: [{ title: 'Phase 0 Blueprint', to: '/implementation/phase-0-blueprint' }]
						}
					]
				},
				// TODO: Replace with Syr logo before release (e.g. logo: '/syr.svg')
				logo: '/sveltepress.svg',
				editLink: 'https://github.com/syr-is/syr/edit/main/apps/docs/src/routes/:route',
				github: 'https://github.com/syr-is/syr',
				highlighter: {
					languages: ['svelte', 'sh', 'js', 'html', 'ts', 'md', 'css', 'scss', 'json']
				}
			}),
			siteConfig: {
				title: 'Syr',
				description: 'Syr architecture and identity documentation'
			}
		})
	]
});

export default config;
