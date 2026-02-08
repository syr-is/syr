<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import {
		ChevronLeft,
		ChevronRight,
		FileAudio,
		FileDown,
		ExternalLink,
		Download,
		Loader2
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { fetchAlbumArt } from '$lib/utils/media';
	import {
		type DisplayItem,
		getItemUrl,
		getItemFilename,
		getItemMediaType,
		isItemViewable
	} from '$lib/types/display-item';

	let {
		items,
		open = $bindable(false),
		initialIndex = 0
	}: {
		items: DisplayItem[];
		open?: boolean;
		initialIndex?: number;
	} = $props();

	let currentIndex = $state(initialIndex);
	let albumArtUrl = $state<string | null>(null);

	const currentItem = $derived(items[currentIndex]);
	const currentUrl = $derived(currentItem ? getItemUrl(currentItem) : '');
	const currentFilename = $derived(currentItem ? getItemFilename(currentItem) : 'file');
	const currentMediaType = $derived(currentItem ? getItemMediaType(currentItem) : 'other');
	const hasPrev = $derived(currentIndex > 0);
	const hasNext = $derived(currentIndex < items.length - 1);

	// Sync currentIndex when the modal opens with a new initialIndex
	$effect(() => {
		if (open) {
			currentIndex = initialIndex;
		}
	});

	// Load album art for audio files with race-condition guard
	let albumArtRequestId = 0;
	$effect(() => {
		albumArtUrl = null;
		const url = currentUrl;
		const type = currentMediaType;
		if (type !== 'audio' || !url) return;

		const requestId = ++albumArtRequestId;
		fetchAlbumArt(url)
			.then((artUrl) => {
				if (requestId === albumArtRequestId) {
					albumArtUrl = artUrl;
				}
			})
			.catch(() => {
				if (requestId === albumArtRequestId) {
					albumArtUrl = null;
				}
			});
	});

	// Download via fetch+Blob to handle cross-origin URLs
	let downloading = $state(false);

	async function handleDownload() {
		if (!currentUrl || downloading) return;
		downloading = true;
		try {
			const response = await fetch(currentUrl, { mode: 'cors' });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const blob = await response.blob();
			const objectUrl = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = objectUrl;
			a.download = currentFilename;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(objectUrl);
		} catch {
			// Fallback: open in new tab so the user can save manually
			window.open(currentUrl, '_blank');
			toast.info('Could not download directly — opened in a new tab instead');
		} finally {
			downloading = false;
		}
	}

	// Keyboard navigation
	$effect(() => {
		if (!open) return;

		function handleKeydown(e: KeyboardEvent) {
			if (e.key === 'ArrowLeft' && hasPrev) {
				e.preventDefault();
				currentIndex--;
			} else if (e.key === 'ArrowRight' && hasNext) {
				e.preventDefault();
				currentIndex++;
			}
		}

		window.addEventListener('keydown', handleKeydown);
		return () => window.removeEventListener('keydown', handleKeydown);
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-4xl">
		<Dialog.Header>
			<Dialog.Title class="max-w-[500px] truncate">{currentFilename}</Dialog.Title>
			<Dialog.Description>
				{currentIndex + 1} of {items.length}
			</Dialog.Description>
		</Dialog.Header>

		<!-- Preview area with navigation overlays -->
		<div class="relative flex min-h-[300px] items-center justify-center overflow-hidden py-4">
			<!-- Previous button -->
			{#if hasPrev}
				<Button
					variant="outline"
					size="icon"
					class="absolute left-2 z-10 h-10 w-10 rounded-full bg-background/80 backdrop-blur-sm"
					onclick={() => currentIndex--}
				>
					<ChevronLeft class="h-5 w-5" />
				</Button>
			{/if}

			<!-- Media content -->
			{#key currentIndex}
				{#if currentMediaType === 'image'}
					<img
						src={currentUrl}
						alt={currentFilename}
						class="max-h-[80vh] w-auto max-w-full rounded-lg object-contain"
					/>
				{:else if currentMediaType === 'video'}
					<video
						src={currentUrl}
						controls
						class="max-h-[80vh] w-auto max-w-full rounded-lg"
						preload="metadata"
					>
						<track kind="captions" />
					</video>
				{:else if currentMediaType === 'audio'}
					<div class="flex w-full flex-col items-center gap-4 py-8">
						{#if albumArtUrl}
							<img
								src={albumArtUrl}
								alt="Album art"
								class="h-48 w-48 rounded-lg object-cover shadow-md"
							/>
						{:else}
							<FileAudio class="h-16 w-16 text-muted-foreground" />
						{/if}
						<p class="text-sm font-medium">{currentFilename}</p>
						<audio src={currentUrl} controls class="w-full max-w-md" preload="metadata">
							<track kind="captions" />
						</audio>
					</div>
				{:else}
					<!-- Non-viewable file -->
					<div class="flex flex-col items-center gap-3 py-12 text-muted-foreground">
						<FileDown class="h-16 w-16" />
						<p class="text-sm font-medium">{currentFilename}</p>
						<p class="text-xs">This file type cannot be previewed</p>
					</div>
				{/if}
			{/key}

			<!-- Next button -->
			{#if hasNext}
				<Button
					variant="outline"
					size="icon"
					class="absolute right-2 z-10 h-10 w-10 rounded-full bg-background/80 backdrop-blur-sm"
					onclick={() => currentIndex++}
				>
					<ChevronRight class="h-5 w-5" />
				</Button>
			{/if}
		</div>

		<Dialog.Footer>
			{#if currentItem && isItemViewable(currentItem)}
				<Button variant="outline" onclick={() => window.open(currentUrl, '_blank')}>
					<ExternalLink class="mr-2 h-4 w-4" />
					Open in new tab
				</Button>
			{/if}
			<Button onclick={handleDownload} disabled={downloading}>
				{#if downloading}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Downloading...
				{:else}
					<Download class="mr-2 h-4 w-4" />
					Download
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
