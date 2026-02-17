<script lang="ts">
	import * as Dialog from '@syr-is/ui/dialog';
	import { Button } from '@syr-is/ui/button';
	import { Skeleton } from '@syr-is/ui/skeleton';
	import type { Upload } from '@syr-is/types';
	import {
		ChevronLeft,
		ChevronRight,
		FileAudio,
		FileDown,
		ExternalLink,
		Download,
		Link,
		Loader2
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { fetchAlbumArt } from '$lib/utils/media';
	import { formatFileSize } from '$lib/utils/format';
	import {
		type DisplayItem,
		getItemUrl,
		getItemFilename,
		getItemMediaType,
		isItemViewable,
		resolveItemUrl
	} from '$lib/types/display-item';

	let {
		items,
		open = $bindable(false),
		initialIndex = 0,
		onOpenShareDialog
	}: {
		items: DisplayItem[];
		open?: boolean;
		initialIndex?: number;
		/** Called when user clicks Share on a file-kind item (private files) */
		onOpenShareDialog?: (upload: Upload) => void;
	} = $props();

	let currentIndex = $state(0);
	let albumArtUrl = $state<string | null>(null);

	// URL resolution state for 'file' kind items (need signed URLs)
	let resolvedUrl = $state<string | null>(null);
	let resolvedIsPublic = $state(false);
	let urlLoading = $state(false);

	const currentItem = $derived(items[currentIndex]);
	const currentFilename = $derived(currentItem ? getItemFilename(currentItem) : 'file');
	const currentMediaType = $derived(currentItem ? getItemMediaType(currentItem) : 'other');
	const hasPrev = $derived(currentIndex > 0);
	const hasNext = $derived(currentIndex < items.length - 1);

	// The effective URL to use for rendering — either directly from the item or resolved via API
	const effectiveUrl = $derived(
		currentItem?.kind === 'file' ? resolvedUrl : currentItem ? getItemUrl(currentItem) : null
	);

	// Whether to show file metadata (mime type, size) in the header
	const currentFileItem = $derived(currentItem?.kind === 'file' ? currentItem : null);

	// Sync currentIndex only when the modal transitions from closed to open,
	// so parent re-renders that change initialIndex while open don't overwrite user navigation.
	let prevOpen = $state(false);
	$effect(() => {
		const wasOpen = prevOpen;
		prevOpen = open;
		if (open && !wasOpen) {
			currentIndex = initialIndex;
		}
	});

	// Resolve URL for 'file' kind items when currentItem changes
	let urlRequestId = 0;
	$effect(() => {
		// Reset URL state
		resolvedUrl = null;
		resolvedIsPublic = false;

		const item = currentItem;
		if (!item) {
			urlLoading = false;
			return;
		}

		if (item.kind === 'media-url') {
			// Already have a usable URL
			resolvedUrl = item.url;
			resolvedIsPublic = true;
			urlLoading = false;
			return;
		}

		if (item.kind === 'folder') {
			urlLoading = false;
			return;
		}

		// kind === 'file' — need to fetch a signed URL
		urlLoading = true;
		const requestId = ++urlRequestId;

		resolveItemUrl(item)
			.then((result) => {
				if (requestId !== urlRequestId) return; // stale
				if (result) {
					resolvedUrl = result.url;
					resolvedIsPublic = result.isPublic;
				}
			})
			.catch(() => {
				if (requestId !== urlRequestId) return;
				resolvedUrl = null;
			})
			.finally(() => {
				if (requestId !== urlRequestId) return;
				urlLoading = false;
			});
	});

	// Load album art for audio files with race-condition guard
	let albumArtRequestId = 0;
	$effect(() => {
		albumArtUrl = null;
		const url = effectiveUrl;
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

	// Download handler — adapts strategy based on item kind
	let downloading = $state(false);

	async function handleDownload() {
		if (downloading) return;
		const item = currentItem;
		if (!item || item.kind === 'folder') return;

		downloading = true;
		try {
			if (item.kind === 'file') {
				// For file items, fetch download URL via API
				const result = await resolveItemUrl(item);
				if (result?.url) {
					window.open(result.url, '_blank');
				} else {
					toast.error('Download URL not available');
				}
			} else {
				// For media-url items, use fetch+Blob for cross-origin support
				const url = getItemUrl(item);
				const response = await fetch(url, { mode: 'cors' });
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
			}
		} catch {
			// Fallback: open in new tab
			const url = effectiveUrl;
			if (url) {
				window.open(url, '_blank');
				toast.info('Could not download directly — opened in a new tab instead');
			} else {
				toast.error('Failed to download file');
			}
		} finally {
			downloading = false;
		}
	}

	// Copy Link / Share handler for file items
	async function handleCopyOrShare() {
		const item = currentItem;
		if (!item || item.kind !== 'file') return;

		if (!effectiveUrl) {
			toast.error('URL not available');
			return;
		}

		if (resolvedIsPublic) {
			try {
				await navigator.clipboard.writeText(effectiveUrl);
				toast.success('Link copied to clipboard');
			} catch {
				toast.error('Failed to copy link');
			}
			return;
		}

		// For private files, open share dialog for custom expiry
		onOpenShareDialog?.(item.data);
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
				{#if items.length > 1}
					{currentIndex + 1} of {items.length}
					{#if currentFileItem}
						<span class="ml-2 text-muted-foreground">
							• {currentFileItem.mimeType} • {formatFileSize(currentFileItem.size)}
						</span>
					{/if}
				{:else if currentFileItem}
					{currentFileItem.mimeType} • {formatFileSize(currentFileItem.size)}
				{/if}
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
				{#if urlLoading}
					<Skeleton class="h-64 w-full" />
				{:else if effectiveUrl}
					{#if currentMediaType === 'image'}
						<img
							src={effectiveUrl}
							alt={currentFilename}
							class="max-h-[80vh] w-auto max-w-full rounded-lg object-contain"
							onerror={(e) => {
								const el = e.currentTarget as HTMLImageElement;
								if (el) el.style.display = 'none';
							}}
						/>
					{:else if currentMediaType === 'video'}
						<video
							src={effectiveUrl}
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
							<audio src={effectiveUrl} controls class="w-full max-w-md" preload="metadata">
								<track kind="captions" />
							</audio>
						</div>
					{:else if currentMediaType === 'pdf'}
						<iframe
							src={effectiveUrl}
							title={currentFilename}
							class="h-[60vh] w-full rounded-lg border"
						>
							Your browser does not support PDF preview.
						</iframe>
					{:else}
						<!-- Non-viewable file -->
						<div class="flex flex-col items-center gap-3 py-12 text-muted-foreground">
							<FileDown class="h-16 w-16" />
							<p class="text-sm font-medium">{currentFilename}</p>
							<p class="text-xs">This file type cannot be previewed</p>
						</div>
					{/if}
				{:else}
					<p class="text-muted-foreground">Preview not available</p>
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
			{#if currentItem?.kind === 'file' && effectiveUrl}
				<Button variant="outline" onclick={handleCopyOrShare}>
					<Link class="mr-2 h-4 w-4" />
					{resolvedIsPublic ? 'Copy Link' : 'Share...'}
				</Button>
			{/if}
			{#if currentItem && isItemViewable(currentItem) && effectiveUrl}
				<Button
					variant="outline"
					onclick={() => effectiveUrl && window.open(effectiveUrl, '_blank')}
				>
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
