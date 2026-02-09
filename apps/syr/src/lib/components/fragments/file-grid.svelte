<script lang="ts">
	import {
		type DisplayItem,
		getItemUrl,
		getItemFilename,
		getItemMimeType
	} from '$lib/types/display-item';
	import FileCard from '$lib/components/fragments/file-card.svelte';
	import FolderCard from '$lib/components/fragments/folder-card.svelte';
	import MediaThumbnail from '$lib/components/fragments/media-thumbnail.svelte';
	import type { Folder } from '@syr-is/types';

	let {
		items,
		mode = 'gallery',
		onItemClick,
		onFolderClick,
		onFolderDelete
	}: {
		items: DisplayItem[];
		mode?: 'gallery' | 'masonry';
		onItemClick?: (index: number) => void;
		onFolderClick?: (folder: Folder) => void;
		onFolderDelete?: (folder: Folder) => void;
	} = $props();

	// Split items into folders and files for rendering order
	const folderItems = $derived(
		items.filter((i): i is Extract<DisplayItem, { kind: 'folder' }> => i.kind === 'folder')
	);
	const fileItems = $derived(
		items.filter((i): i is Exclude<DisplayItem, { kind: 'folder' }> => i.kind !== 'folder')
	);
</script>

{#if mode === 'gallery'}
	<!-- Gallery: uniform aspect-square grid -->
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
		{#each folderItems as item (item.id)}
			<FolderCard
				folder={item.data}
				isPublic={item.isPublic}
				onclick={() => onFolderClick?.(item.data)}
				onDelete={onFolderDelete}
			/>
		{/each}
		{#each fileItems as item, i (item.id)}
			<FileCard {item} onclick={() => onItemClick?.(i)} />
		{/each}
	</div>
{:else}
	<!-- Masonry: CSS columns layout -->
	{#if folderItems.length > 0}
		<div class="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
			{#each folderItems as item (item.id)}
				<FolderCard
					folder={item.data}
					isPublic={item.isPublic}
					onclick={() => onFolderClick?.(item.data)}
					onDelete={onFolderDelete}
				/>
			{/each}
		</div>
	{/if}
	<div class="columns-1 gap-4 sm:columns-2 lg:columns-3">
		{#each fileItems as item, i (item.id)}
			{@const url = getItemUrl(item)}
			{@const filename = getItemFilename(item)}
			{@const mimeType = getItemMimeType(item)}
			<div class="mb-4 break-inside-avoid">
				<MediaThumbnail
					{url}
					{mimeType}
					mode="full"
					alt={filename}
					{item}
					class="w-full rounded-lg shadow-sm transition-shadow hover:shadow-md"
					onImageClick={() => onItemClick?.(i)}
				/>
			</div>
		{/each}
	</div>
{/if}
