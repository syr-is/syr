import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), devtoolsJson()],
	ssr: {
		noExternal: ['@syr-is/ui']
	},
	resolve: {
		alias: {
			// Tailwind plugin uses enhanced-resolve which doesn't fully respect package.json exports
			// '@syr-is/ui/styles': resolve(process.cwd(), '../../../packages/ui/src/app.css')
		}
	}
});
// Force restart
