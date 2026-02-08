<script lang="ts">
	import {
		type DisplayItem,
		getItemUrl,
		getItemFilename,
		getItemMimeType
	} from '$lib/types/display-item';
	import MediaThumbnail from '$lib/components/fragments/media-thumbnail.svelte';

	let {
		item,
		onclick
	}: {
		item: DisplayItem;
		onclick?: () => void;
	} = $props();

	const url = $derived(getItemUrl(item));
	const filename = $derived(getItemFilename(item));
	const mimeType = $derived(getItemMimeType(item));
</script>

<button
	type="button"
	class="group relative aspect-square cursor-pointer overflow-hidden rounded-lg bg-muted transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
	{onclick}
>
	<MediaThumbnail {url} {mimeType} mode="card" alt={filename} />

	<!-- Filename overlay at bottom -->
	<div
		class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2"
	>
		<p class="truncate text-xs text-white">{filename}</p>
	</div>
</button>
