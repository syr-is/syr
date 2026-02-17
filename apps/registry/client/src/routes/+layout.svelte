<script lang="ts">
	import { Toaster } from '@syr-is/ui/sonner';
	import { Button } from '@syr-is/ui/button';
	import { ModeWatcher } from 'mode-watcher';
	import { toggleMode } from 'mode-watcher';
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import '../app.css';

	let { children } = $props();
</script>

<ModeWatcher />
<Toaster />

<header class="flex shrink-0 items-center justify-end gap-2 border-b px-4 py-3">
	<Button onclick={toggleMode} variant="outline" size="icon" class="relative">
		<SunIcon
			class="size-[1.2rem] scale-100 rotate-0 !transition-all dark:scale-0 dark:-rotate-90"
		/>
		<MoonIcon
			class="absolute size-[1.2rem] scale-0 rotate-90 !transition-all dark:scale-100 dark:rotate-0"
		/>
		<span class="sr-only">Toggle theme</span>
	</Button>
	<a href="/docs">
		<Button variant="outline" size="sm">Docs</Button>
	</a>
</header>
<main class="min-h-screen">
	{@render children?.()}
</main>
