<script lang="ts">
	import * as Carousel from '$lib/components/ui/carousel/index.js';
	import type { CarouselAPI } from '$lib/components/ui/carousel/context.js';
	import { Button } from '$lib/components/ui/button';
	import { LayoutGrid, GalleryHorizontal, FileDown } from 'lucide-svelte';
	import type { MediaDisplayMode } from '@syr-is/types';
	import { isVideo, isImage, isAudio } from '$lib/utils/media';

	interface Props {
		mediaUrls: string[];
		defaultMode?: MediaDisplayMode;
	}

	let { mediaUrls, defaultMode = 'masonry' }: Props = $props();

	let currentMode: MediaDisplayMode = $state(defaultMode);
	let api = $state<CarouselAPI>();
	let current = $state(0);
	const count = $derived(api ? api.scrollSnapList().length : 0);

	$effect(() => {
		if (!api) return;

		const onSelect = () => {
			current = api!.selectedScrollSnap() + 1;
		};

		api.on('select', onSelect);
		// Set initial value
		onSelect();

		return () => {
			api!.off('select', onSelect);
		};
	});

	/** Extract a display filename from a URL */
	function getFileName(url: string): string {
		const path = url.split('?')[0];
		const segments = path.split('/');
		return decodeURIComponent(segments[segments.length - 1] || 'file');
	}
</script>

{#if mediaUrls.length === 0}
	<p class="py-8 text-center text-muted-foreground">No media items.</p>
{:else}
	<!-- View toggle -->
	<div class="mb-4 flex items-center justify-end gap-1">
		<Button
			variant={currentMode === 'masonry' ? 'default' : 'outline'}
			size="sm"
			onclick={() => (currentMode = 'masonry')}
		>
			<LayoutGrid class="mr-1.5 h-4 w-4" />
			Grid
		</Button>
		<Button
			variant={currentMode === 'carousel' ? 'default' : 'outline'}
			size="sm"
			onclick={() => (currentMode = 'carousel')}
		>
			<GalleryHorizontal class="mr-1.5 h-4 w-4" />
			Carousel
		</Button>
	</div>

	{#if currentMode === 'carousel'}
		<!-- Carousel mode -->
		<div class="mx-auto w-full max-w-3xl">
			<Carousel.Root class="w-full" setApi={(emblaApi) => (api = emblaApi)}>
				<Carousel.Content>
					{#each mediaUrls as url, i (`${url}-${i}`)}
						<Carousel.Item>
							<div class="flex items-center justify-center rounded-lg bg-muted/30 p-2">
								{#if isVideo(url)}
									<video
										src={url}
										controls
										class="max-h-[500px] w-full rounded-md object-contain"
										preload="metadata"
									>
										<track kind="captions" />
									</video>
								{:else if isAudio(url)}
									<audio src={url} controls class="w-full">
										<track kind="captions" />
									</audio>
								{:else if isImage(url)}
									<a href={url} target="_blank" rel="noopener noreferrer">
										<img
											src={url}
											alt="Media {i + 1}"
											class="max-h-[500px] w-full cursor-pointer rounded-md object-contain"
											loading="lazy"
										/>
									</a>
								{:else}
									<!-- Non-viewable file: show download link -->
									<a
										href={url}
										download
										class="flex flex-col items-center gap-2 rounded-md bg-muted/50 p-8 text-muted-foreground transition-colors hover:bg-muted"
									>
										<FileDown class="h-10 w-10" />
										<span class="text-sm font-medium">{getFileName(url)}</span>
										<span class="text-xs">Click to download</span>
									</a>
								{/if}
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
	{:else}
		<!-- Masonry grid mode -->
		<div class="columns-1 gap-4 sm:columns-2 lg:columns-3">
			{#each mediaUrls as url, i (`${url}-${i}`)}
				<div class="mb-4 break-inside-avoid">
					{#if isVideo(url)}
						<video
							src={url}
							controls
							class="w-full rounded-lg shadow-sm transition-shadow hover:shadow-md"
							preload="metadata"
						>
							<track kind="captions" />
						</video>
					{:else if isAudio(url)}
						<audio src={url} controls class="w-full">
							<track kind="captions" />
						</audio>
					{:else if isImage(url)}
						<a href={url} target="_blank" rel="noopener noreferrer">
							<img
								src={url}
								alt="Media {i + 1}"
								class="w-full cursor-pointer rounded-lg shadow-sm transition-shadow hover:shadow-md"
								loading="lazy"
							/>
						</a>
					{:else}
						<!-- Non-viewable file: show download link -->
						<a
							href={url}
							download
							class="flex flex-col items-center gap-2 rounded-lg bg-muted/50 p-6 text-muted-foreground shadow-sm transition-shadow hover:bg-muted hover:shadow-md"
						>
							<FileDown class="h-10 w-10" />
							<span class="text-sm font-medium">{getFileName(url)}</span>
							<span class="text-xs">Click to download</span>
						</a>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
{/if}
