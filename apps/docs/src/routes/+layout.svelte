<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';

	const { children } = $props();

	async function renderMermaid() {
		const nodes = document.querySelectorAll<HTMLPreElement>('pre.mermaid');
		if (nodes.length === 0) return;

		const { default: mermaid } = await import('mermaid');
		mermaid.initialize({
			startOnLoad: false,
			theme: 'default',
			securityLevel: 'loose',
			fontFamily: 'inherit'
		});

		// mermaid.run() renders all <pre class="mermaid"> elements
		await mermaid.run({ nodes });
	}

	onMount(() => {
		renderMermaid();
	});

	afterNavigate(() => {
		// Re-render after client-side navigation to a new page
		renderMermaid();
	});
</script>

{@render children?.()}
