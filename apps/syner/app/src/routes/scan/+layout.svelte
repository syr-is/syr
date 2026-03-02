<script lang="ts">
	import { page } from '$app/state';

	// When on scan route, body must be transparent so camera shows through (windowed: true)
	let { children } = $props();
	let isScan = $derived(page.url.pathname.startsWith('/scan'));
</script>

<svelte:head>
	{#if isScan}
		<style>
			html,
			body {
				background: transparent !important;
			}
		</style>
	{/if}
</svelte:head>

{#if isScan}
	<div class="min-h-dvh bg-transparent">
		{@render children?.()}
	</div>
{:else}
	{@render children?.()}
{/if}
