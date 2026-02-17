import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const apiBase = env.PUBLIC_REGISTRY_API_URL || 'http://localhost:3100';

	return {
		plugins: [tailwindcss(), sveltekit()],
		server: {
			proxy: {
				'/api/v1': {
					target: apiBase,
					changeOrigin: true
				},
				'/docs': {
					target: apiBase,
					changeOrigin: true,
					rewrite: (path) => path.replace(/^\/docs/, '/reference')
				}
			}
		}
	};
});
