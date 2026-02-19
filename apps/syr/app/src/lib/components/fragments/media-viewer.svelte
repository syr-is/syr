<script lang="ts">
	import type { MediaDisplayMode } from '@syr-is/types';
	import { urlsToDisplayItems, type ViewMode } from '$lib/types/display-item';
	import ViewModeToggle from '$lib/components/fragments/view-mode-toggle.svelte';
	import FileGrid from '$lib/components/fragments/file-grid.svelte';
	import FileCarousel from '$lib/components/fragments/file-carousel.svelte';
	import MediaPreviewModal from '$lib/components/fragments/media-preview-modal.svelte';

	interface Props {
		mediaUrls: string[];
		mediaUrlMimeTypes?: Record<string, string>;
		mediaUrlFilenames?: Record<string, string>;
		defaultMode?: MediaDisplayMode;
	}

	let {
		mediaUrls,
		mediaUrlMimeTypes = {},
		mediaUrlFilenames = {},
		defaultMode = 'masonry'
	}: Props = $props();

	// Map MediaDisplayMode to ViewMode (they overlap for gallery/masonry/carousel)
	// Writable for bind:mode; init from defaultMode only — do not sync from prop (would override user toggle)
	let currentMode = $state<ViewMode>(defaultMode as ViewMode);

	// Gallery preview modal state
	let previewOpen = $state(false);
	let previewIndex = $state(0);

	// Convert bare URLs to DisplayItems with mime type and filename info from DB
	const displayItems = $derived(
		urlsToDisplayItems(mediaUrls, mediaUrlMimeTypes, mediaUrlFilenames)
	);

	function openPreview(index: number) {
		previewIndex = index;
		previewOpen = true;
	}
</script>

{#if mediaUrls.length === 0}
	<p class="py-8 text-center text-muted-foreground">No media items.</p>
{:else}
	<!-- View toggle -->
	<div class="mb-4 flex items-center justify-end">
		<ViewModeToggle bind:mode={currentMode} availableModes={['masonry', 'carousel', 'gallery']} />
	</div>

	{#if currentMode === 'carousel'}
		<FileCarousel items={displayItems} onItemClick={openPreview} />
	{:else if currentMode === 'gallery'}
		<FileGrid mode="gallery" items={displayItems} onItemClick={openPreview} />
	{:else}
		<FileGrid mode="masonry" items={displayItems} onItemClick={openPreview} />
	{/if}
{/if}

<!-- Preview modal -->
<MediaPreviewModal bind:open={previewOpen} items={displayItems} initialIndex={previewIndex} />
