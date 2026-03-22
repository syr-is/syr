<script lang="ts">
	import {
		type DisplayItem,
		getFileItems,
		getItemUrl,
		getItemFilename,
		getItemMimeType
	} from '$lib/types/display-item';
	import MediaThumbnail from '$lib/components/fragments/media-thumbnail.svelte';

	let {
		items,
		class: className = '',
		onItemClick,
		showMimeType = true
	}: {
		items: DisplayItem[];
		class?: string;
		onItemClick?: (index: number) => void;
		showMimeType?: boolean;
	} = $props();

	const fileItems = $derived(getFileItems(items));

	const shellClass =
		'group w-full overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
</script>

<div
	class="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 {className}"
	data-slot="media-card-grid"
>
	{#each fileItems as item, i (item.id)}
		{@const url = getItemUrl(item)}
		{#if url}
			{#snippet mediaBlock()}
				<!-- Same preview logic as gallery FileCard: image, video+play, audio+art, pdf/other icon -->
				<div
					class="relative aspect-video w-full overflow-hidden bg-muted [&_img]:transition-transform group-hover:[&_img]:scale-[1.02] [&_video]:transition-transform group-hover:[&_video]:scale-[1.02]"
				>
					<MediaThumbnail
						{url}
						mimeType={getItemMimeType(item)}
						mode="card"
						alt={getItemFilename(item)}
						{item}
					/>
				</div>
				<div class="border-t border-border p-2">
					<p class="truncate text-xs font-medium" title={getItemFilename(item)}>
						{getItemFilename(item)}
					</p>
					{#if showMimeType}
						<p class="truncate text-[11px] text-muted-foreground">
							{getItemMimeType(item) ?? '—'}
						</p>
					{/if}
				</div>
			{/snippet}
			{#if onItemClick}
				<button type="button" class="{shellClass} text-left" onclick={() => onItemClick(i)}>
					{@render mediaBlock()}
				</button>
			{:else}
				<a href={url} target="_blank" rel="noopener noreferrer" class="{shellClass} block">
					{@render mediaBlock()}
				</a>
			{/if}
		{/if}
	{/each}
</div>
