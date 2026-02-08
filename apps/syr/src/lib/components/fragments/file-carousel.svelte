<script lang="ts">
	import * as Carousel from '$lib/components/ui/carousel/index.js';
	import type { CarouselAPI } from '$lib/components/ui/carousel/context.js';
	import {
		type DisplayItem,
		getItemUrl,
		getItemFilename,
		getItemMimeType
	} from '$lib/types/display-item';
	import MediaThumbnail from '$lib/components/fragments/media-thumbnail.svelte';

	let {
		items,
		onItemClick
	}: {
		items: DisplayItem[];
		onItemClick?: (index: number) => void;
	} = $props();

	// Filter out folders — not meaningful in carousel mode
	const fileItems = $derived(items.filter((i) => i.kind !== 'folder'));

	let api = $state<CarouselAPI>();
	let current = $state(0);
	const count = $derived(api ? api.scrollSnapList().length : 0);

	$effect(() => {
		if (!api) return;

		const onSelect = () => {
			current = api!.selectedScrollSnap() + 1;
		};

		api.on('select', onSelect);
		onSelect();

		return () => {
			api!.off('select', onSelect);
		};
	});
</script>

<div class="mx-auto w-full max-w-3xl">
	<Carousel.Root class="w-full" setApi={(emblaApi) => (api = emblaApi)}>
		<Carousel.Content>
			{#each fileItems as item, i (item.id)}
				{@const url = getItemUrl(item)}
				{@const filename = getItemFilename(item)}
				{@const mimeType = getItemMimeType(item)}
				<Carousel.Item>
					<div class="flex items-center justify-center rounded-lg bg-muted/30 p-2">
						<MediaThumbnail
							{url}
							{mimeType}
							mode="full"
							alt={filename}
							class="max-h-[500px] w-full rounded-md object-contain"
							onImageClick={() => onItemClick?.(i)}
						/>
					</div>
				</Carousel.Item>
			{/each}
		</Carousel.Content>
		<Carousel.Previous />
		<Carousel.Next />
	</Carousel.Root>
	{#if count > 0}
		<div class="py-2 text-center text-sm text-muted-foreground">
			{current} of {count}
		</div>
	{/if}
</div>
