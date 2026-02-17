<script lang="ts">
	import { Toaster } from '@syr-is/ui/sonner';
	import { ModeWatcher } from 'mode-watcher';
	import '../app.css';

	let { children } = $props();
</script>

<ModeWatcher />
<Toaster />

<main class="min-h-screen">
	{@render children?.()}
</main>
