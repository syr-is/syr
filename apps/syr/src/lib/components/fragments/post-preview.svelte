<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Carousel from '$lib/components/ui/carousel/index.js';
	import type { CarouselAPI } from '$lib/components/ui/carousel/context.js';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import DeletePostDialog from '$lib/components/fragments/delete-post-dialog.svelte';
	import MediaThumbnail from '$lib/components/fragments/media-thumbnail.svelte';
	import MediaPreviewModal from '$lib/components/fragments/media-preview-modal.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { urlsToDisplayItems } from '$lib/types/display-item';
	import {
		Trash2,
		Pin,
		PinOff,
		FilePen,
		ImageIcon,
		ChevronLeft,
		ChevronRight
	} from 'lucide-svelte';
	import type { Post } from '@syr-is/types';

	interface Props {
		post: Post;
		isPinned?: boolean;
		onPinToggle?: (postId: string, isPinned: boolean) => void;
		showPinButton?: boolean;
		/** Optional URL -> mime_type map for accurate media type detection */
		mediaUrlMimeTypes?: Record<string, string>;
	}

	let {
		post,
		isPinned = false,
		onPinToggle,
		showPinButton = true,
		mediaUrlMimeTypes = {}
	}: Props = $props();

	// Check if post is a draft
	const isDraft = $derived(post.status === 'draft');
	let deleteDialogOpen = $state(false);
	let pinLoading = $state(false);

	// Carousel state
	let carouselApi = $state<CarouselAPI>();
	let currentSlide = $state(0);
	const slideCount = $derived(post.media_urls?.length ?? 0);

	$effect(() => {
		if (!carouselApi) return;
		// Capture the API instance so the cleanup closure always has a valid reference,
		// even if carouselApi is reassigned to undefined before teardown runs.
		const api = carouselApi;
		const onSelect = () => {
			currentSlide = api.selectedScrollSnap();
		};
		api.on('select', onSelect);
		onSelect();
		return () => {
			api.off('select', onSelect);
		};
	});

	// Preview modal state
	let previewOpen = $state(false);
	let previewIndex = $state(0);
	const displayItems = $derived(
		post.type === 'media' && post.media_urls?.length
			? urlsToDisplayItems(post.media_urls, mediaUrlMimeTypes)
			: []
	);

	function openPreview(index: number, e: MouseEvent) {
		e.stopPropagation();
		e.preventDefault();
		previewIndex = index;
		previewOpen = true;
	}

	async function handlePinToggle(e: MouseEvent) {
		e.stopPropagation();
		if (!onPinToggle || pinLoading) return;

		pinLoading = true;
		try {
			const postId = typeof post.id === 'string' ? post.id : post.id.toString();
			await onPinToggle(postId, isPinned);
		} finally {
			pinLoading = false;
		}
	}

	// Format date
	function formatDate(date: Date | string): string {
		const d = typeof date === 'string' ? new Date(date) : date;
		return new Intl.DateTimeFormat('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		}).format(d);
	}

	// Get display text - prefer description, fall back to truncated content or media count
	function getDisplayText(post: Post): string {
		if (post.description) {
			return post.description;
		}
		if (post.type === 'media') {
			const count = post.media_urls?.length ?? 0;
			return count === 0 ? 'No media items' : `${count} media item${count === 1 ? '' : 's'}`;
		}
		if (!post.content) return 'No content';
		// Strip markdown syntax and HTML tags for fallback
		const plainText = post.content
			.replace(/[#*_`~[\]()]/g, '')
			.replace(/<[^>]*>/g, '')
			.replace(/\n/g, ' ')
			.trim();
		return plainText.length > 150 ? plainText.substring(0, 150) + '...' : plainText;
	}

	// Get visibility badge variant
	function getVisibilityVariant(
		visibility: string
	): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (visibility === 'public') return 'default';
		if (visibility === 'unlisted') return 'secondary';
		return 'destructive';
	}
</script>

<Card.Root
	class="transition-all hover:border-primary/50 hover:shadow-md {isDraft
		? 'border-warning/50 border-dashed'
		: ''}"
>
	<Card.Header>
		<div class="flex flex-wrap items-start gap-2">
			<Card.Title class="line-clamp-2 min-w-0 flex-1">
				{post.title || 'Untitled Post'}
			</Card.Title>
			<div class="ml-auto flex flex-wrap gap-1">
				{#if isDraft}
					<Badge variant="outline" class="border-warning text-warning gap-1 text-xs">
						<FilePen class="h-3 w-3" />
						Draft
					</Badge>
				{/if}
				<Badge variant={getVisibilityVariant(post.visibility)} class="text-xs">
					{post.visibility}
				</Badge>
				<Badge variant="outline" class="text-xs">
					{post.type === 'media' ? 'media' : post.content_type}
				</Badge>
			</div>
		</div>
		<Card.Description class="text-xs text-muted-foreground">
			{#if isDraft}
				Last edited {formatDate(post.updated_at)}
			{:else}
				{formatDate(post.created_at)}
			{/if}
		</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if post.type === 'media' && post.media_urls && post.media_urls.length > 0}
			<!-- Media carousel preview -->
			<div class="relative mb-3 overflow-hidden rounded-lg bg-muted">
				<Carousel.Root
					class="w-full"
					setApi={(api) => (carouselApi = api)}
					opts={{ loop: post.media_urls.length > 1 }}
				>
					<Carousel.Content class="-ml-0">
						{#each post.media_urls as url, i (`${url}-${i}`)}
							<Carousel.Item class="pl-0">
								<div class="relative h-40 overflow-hidden">
									<!-- Loading placeholder -->
									<Skeleton class="absolute inset-0 h-full w-full rounded-none" />
									<!-- Media content via shared component -->
									<div class="relative z-[1] h-full w-full">
										<MediaThumbnail
											{url}
											mimeType={mediaUrlMimeTypes[url]}
											mode="card"
											alt="Media {i + 1}"
										/>
									</div>
									<!-- Invisible click overlay (opens preview, sits below arrows) -->
									<button
										type="button"
										class="absolute inset-0 z-[5] cursor-pointer opacity-0 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
										aria-label="Preview media {i + 1}"
										onclick={(e) => openPreview(i, e)}
									></button>
								</div>
							</Carousel.Item>
						{/each}
					</Carousel.Content>
					{#if post.media_urls.length > 1}
						<!-- Prev / Next arrows -->
						<button
							type="button"
							aria-label="Previous slide"
							class="absolute top-1/2 left-1 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-opacity hover:bg-black/70"
							onclick={(e) => {
								e.stopPropagation();
								carouselApi?.scrollPrev();
							}}
						>
							<ChevronLeft class="h-4 w-4" aria-hidden="true" />
						</button>
						<button
							type="button"
							aria-label="Next slide"
							class="absolute top-1/2 right-1 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-opacity hover:bg-black/70"
							onclick={(e) => {
								e.stopPropagation();
								carouselApi?.scrollNext();
							}}
						>
							<ChevronRight class="h-4 w-4" aria-hidden="true" />
						</button>
						<!-- Slide counter -->
						<div
							class="absolute right-2 bottom-2 z-10 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white"
						>
							{currentSlide + 1} / {slideCount}
						</div>
					{/if}
				</Carousel.Root>
			</div>
		{:else}
			<!-- Blog / empty-media preview: text content area matching media card height -->
			<div class="relative mb-3 h-40 overflow-hidden rounded-lg bg-muted/30 p-4">
				<p class="text-sm leading-relaxed text-muted-foreground">
					{getDisplayText(post)}
				</p>
				<div
					class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background to-transparent"
				></div>
			</div>
		{/if}

		<div class="flex items-start justify-between gap-2">
			{#if post.type === 'media' && post.media_urls && post.media_urls.length > 0}
				<p class="flex-1 text-sm text-muted-foreground">
					<ImageIcon class="mr-1 inline h-3.5 w-3.5" />
					{getDisplayText(post)}
				</p>
			{:else}
				<p class="line-clamp-1 flex-1 text-sm text-muted-foreground">
					{post.title || 'Untitled Post'}
				</p>
			{/if}
			<div class="flex gap-1">
				{#if showPinButton && onPinToggle}
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="ghost"
									size="icon"
									class="h-8 w-8 {isPinned
										? 'text-primary hover:bg-primary/10'
										: 'text-muted-foreground hover:bg-muted'}"
									onclick={handlePinToggle}
									disabled={pinLoading}
								>
									{#if isPinned}
										<PinOff class="h-4 w-4" />
									{:else}
										<Pin class="h-4 w-4" />
									{/if}
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content>
							{isPinned ? 'Unpin post' : 'Pin post'}
						</Tooltip.Content>
					</Tooltip.Root>
				{/if}
				<Button
					variant="ghost"
					size="icon"
					class="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
					onclick={(e) => {
						e.stopPropagation();
						deleteDialogOpen = true;
					}}
				>
					<Trash2 class="h-4 w-4" />
				</Button>
			</div>
		</div>
	</Card.Content>
</Card.Root>

<DeletePostDialog bind:open={deleteDialogOpen} {post} />

{#if displayItems.length > 0}
	<MediaPreviewModal bind:open={previewOpen} items={displayItems} initialIndex={previewIndex} />
{/if}
