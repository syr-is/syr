<script lang="ts">
	import * as Carousel from '$lib/components/ui/carousel/index.js';
	import type { CarouselAPI } from '$lib/components/ui/carousel/context.js';
	import { Button } from '$lib/components/ui/button';
	import { LayoutGrid, GalleryHorizontal } from 'lucide-svelte';
	import type { MediaDisplayMode } from '@syr-is/types';

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
		if (api) {
			current = api.selectedScrollSnap() + 1;
			api.on('select', () => {
				current = api!.selectedScrollSnap() + 1;
			});
		}
	});

	const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
	const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'];
	const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'];

	function isVideo(url: string): boolean {
		const lower = url.toLowerCase().split('?')[0];
		return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
	}

	function isAudio(url: string): boolean {
		const lower = url.toLowerCase().split('?')[0];
		return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
	}

	function isImage(url: string): boolean {
		const lower = url.toLowerCase().split('?')[0];
		if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
		// If it's not a video or audio, default to treating it as an image
		return !isVideo(url) && !isAudio(url);
	}

	/** Check if a URL points to a browser-viewable type (image, video, audio) */
	function isViewable(url: string): boolean {
		return isImage(url) || isVideo(url) || isAudio(url);
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
			<Carousel.Root
				class="w-full"
				setApi={(emblaApi) => (api = emblaApi)}
			>
				<Carousel.Content>
					{#each mediaUrls as url, i (url)}
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
									<!-- svelte-ignore a11y_media_has_caption -->
									<audio src={url} controls class="w-full"></audio>
								{:else}
									<a
										href={url}
										target="_blank"
										rel="noopener noreferrer"
										download={!isViewable(url) || undefined}
									>
										<img
											src={url}
											alt="Media {i + 1}"
											class="max-h-[500px] w-full cursor-pointer rounded-md object-contain"
											loading="lazy"
										/>
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
			{#each mediaUrls as url, i (url)}
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
						<!-- svelte-ignore a11y_media_has_caption -->
						<audio src={url} controls class="w-full"></audio>
					{:else}
						<a
							href={url}
							target="_blank"
							rel="noopener noreferrer"
							download={!isViewable(url) || undefined}
						>
							<img
								src={url}
								alt="Media {i + 1}"
								class="w-full cursor-pointer rounded-lg shadow-sm transition-shadow hover:shadow-md"
								loading="lazy"
							/>
						</a>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
{/if}
