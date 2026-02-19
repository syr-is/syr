import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), devtoolsJson()],
	ssr: {
		// Regex ensures subpath imports like @syr-is/ui/sonner are bundled (not externalized)
		noExternal: [/^@syr-is\/ui($|\/)/]
	}
});
