import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const workspaceRoot = searchForWorkspaceRoot(process.cwd());

export default defineConfig({
	// Load .env from monorepo root so PUBLIC_URL, ALLOWED_ORIGINS, etc. are available
	envDir: workspaceRoot,
	plugins: [tailwindcss(), sveltekit(), devtoolsJson()],
	server: {
		fs: {
			allow: [searchForWorkspaceRoot(process.cwd())]
		}
	},
	ssr: {
		noExternal: [/^@syr-is\/ui($|\/)/],
		external: ['@syr-is/crypto']
	}
});
